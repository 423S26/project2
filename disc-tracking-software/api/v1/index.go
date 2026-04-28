//NOTE: UNIT TESTS ARE IN A SEPARATE FILE (main_test.go) TO AVOID IMPORT CYCLES WITH THE PROTOBUF STRUCTS

package handler

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql" //placeholder before hooking up to actual database, but calls will be very similar in their place here
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"project2/disc-tracking-software/backend/handlers"
	"project2/disc-tracking-software/backend/pb"
	"runtime"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	_ "github.com/lib/pq"
	"google.golang.org/protobuf/proto"
)

//------------------------------------------

func loadDotEnvFiles() {
	// Load from current working directory first.
	_ = godotenv.Load(".env.local", ".env")

	// Then load relative to this file so go run works from different cwd values.
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		return
	}

	goDir := filepath.Dir(file)
	repoRoot := filepath.Clean(filepath.Join(goDir, "..", "..", ".."))
	_ = godotenv.Overload(filepath.Join(repoRoot, ".env.local"), filepath.Join(repoRoot, ".env"))
}

func normalizeDatabaseURL(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return raw
	}

	query := parsed.Query()
	if query.Get("disable_prepared_binary_result") == "" {
		query.Set("disable_prepared_binary_result", "yes")
	}
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

//------------------------------------------

type AuthClaims struct {
	Sub    string `json:"sub"`
	UserID string `json:"user_id"`
	Exp    int64  `json:"exp"`
	Iat    int64  `json:"iat"`
	Iss    string `json:"iss"`
	Aud    string `json:"aud"`
}

//------------------------------------------

// ProcessSpatialData calculates the 3D distance between the observer device
// (phone/laptop running the app) and the disc using the Haversine formula for
// the surface component and a simple vertical delta for the Z axis.
// phoneLat/phoneLon: GPS coords of the device running the app.
// discLat/discLon:   GPS coords from the tracking hardware protobuf (Ping.Lat/Lon).
// discAlt:           Altitude from the Ping in metres.
// referenceAlt:      Altitude of the observer/tee in metres.
func ProcessSpatialData(phoneLat, phoneLon, discLat, discLon, discAlt, referenceAlt float64) (distanceMeters float64, verticalDelta float64) {
	if discLat == 0 && discLon == 0 {
		return 0, 0
	}
	surfaceDist := Haversine(phoneLat, phoneLon, discLat, discLon)
	verticalDelta = discAlt - referenceAlt
	distanceMeters = math.Sqrt(math.Pow(surfaceDist, 2) + math.Pow(verticalDelta, 2))
	return distanceMeters, verticalDelta
}

// Haversine calculates the great-circle distance between two points on the Earth.
func Haversine(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371000 // in meters

	lat1Rad := lat1 * math.Pi / 180
	lat2Rad := lat2 * math.Pi / 180
	deltaLat := (lat2 - lat1) * math.Pi / 180
	deltaLon := (lon2 - lon1) * math.Pi / 180

	a := math.Sin(deltaLat/2)*math.Sin(deltaLat/2) +
		math.Cos(lat1Rad)*math.Cos(lat2Rad)*
			math.Sin(deltaLon/2)*math.Sin(deltaLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))

	return R * c
}

func CalculateRPM(gyroZDegPerSec float64) float64 {
	// 1 RPM = 6 deg/s  (360 deg / 60 s)
	rpm := math.Abs(gyroZDegPerSec) / 6.0

	if rpm < 5 {
		return 0
	}
	return rpm
}

// IMUState is the interpreted output from a single LSM6DS3 reading.
// All accel fields are in G, all gyro fields are in deg/s.
type IMUState struct {
	RPM        float64 // spin rate derived from gyro_z (|gyro_z| / 6)
	Wobble     float64 // deviation of accel_z from 1G — proxy for disc wobble
	IsSpinning bool    // true when RPM > 5
	TotalAccel float64 // magnitude of the full acceleration vector (G)
	TotalGyro  float64 // magnitude of the full angular-rate vector (deg/s)
	HyzerAngle float64 // disc tilt left/right: atan2(accel_y, accel_z) in degrees
	NoseAngle  float64 // nose up/down:          atan2(accel_x, accel_z) in degrees
}

// InterpretIMU converts the raw IMU fields from a hardware.proto Ping into
// human-readable flight metrics. It does not touch GPS or battery fields.
func InterpretIMU(ping *pb.Ping) IMUState {
	ax := float64(ping.GetAccelX())
	ay := float64(ping.GetAccelY())
	az := float64(ping.GetAccelZ())
	gx := float64(ping.GetGyroX())
	gy := float64(ping.GetGyroY())
	gz := float64(ping.GetGyroZ())

	rpm := CalculateRPM(gz)

	return IMUState{
		RPM:        rpm,
		Wobble:     math.Abs(az - 1.0),
		IsSpinning: rpm > 5,
		TotalAccel: math.Sqrt(ax*ax + ay*ay + az*az),
		TotalGyro:  math.Sqrt(gx*gx + gy*gy + gz*gz),
		HyzerAngle: math.Atan2(ay, az) * (180.0 / math.Pi),
		NoseAngle:  math.Atan2(ax, az) * (180.0 / math.Pi),
	}
}

func parseAndVerifyBearerToken(authHeader string, jwtSecret string) (*AuthClaims, error) {
	if !strings.HasPrefix(authHeader, "Bearer ") {
		return nil, errors.New("missing bearer token")
	}

	token := strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, errors.New("invalid JWT format")
	}

	signingInput := parts[0] + "." + parts[1]
	mac := hmac.New(sha256.New, []byte(jwtSecret))
	mac.Write([]byte(signingInput))
	expectedSig := mac.Sum(nil)

	providedSig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, fmt.Errorf("invalid JWT signature encoding: %w", err)
	}

	if !hmac.Equal(providedSig, expectedSig) {
		return nil, errors.New("invalid JWT signature")
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("invalid JWT payload encoding: %w", err)
	}

	var claims AuthClaims
	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return nil, fmt.Errorf("invalid JWT payload JSON: %w", err)
	}

	if claims.Exp > 0 {
		now := time.Now().Unix()
		if now >= claims.Exp {
			return nil, errors.New("token expired")
		}
	}

	return &claims, nil
}

func extractUserIDFromClaims(claims *AuthClaims) string {
	if claims == nil {
		return ""
	}
	if claims.UserID != "" {
		return claims.UserID
	}
	return claims.Sub
}

// decodeTelemetryPings unmarshals a SyncBatch protobuf from the wire.
// The frontend BLE layer always batches pings into a SyncBatch before upload.
func decodeTelemetryPings(body []byte) ([]*pb.Ping, error) {
	if len(body) == 0 {
		return nil, errors.New("empty telemetry payload")
	}

	var syncBatch pb.SyncBatch
	if err := proto.Unmarshal(body, &syncBatch); err != nil {
		return nil, fmt.Errorf("failed to unmarshal SyncBatch: %w", err)
	}

	if len(syncBatch.GetPings()) == 0 {
		return nil, errors.New("SyncBatch contains no pings")
	}

	return syncBatch.GetPings(), nil
}

func normalizePingsDeviceID(pings []*pb.Ping) (string, error) {
	deviceID := ""
	for _, ping := range pings {
		if ping == nil {
			continue
		}

		curr := strings.TrimSpace(ping.GetDeviceId())
		if curr == "" {
			continue
		}

		if deviceID == "" {
			deviceID = curr
			continue
		}

		if curr != deviceID {
			return "", errors.New("telemetry payload contains mixed device_id values")
		}
	}

	if deviceID == "" {
		return "", errors.New("telemetry payload is missing device_id")
	}

	for _, ping := range pings {
		if ping != nil && strings.TrimSpace(ping.GetDeviceId()) == "" {
			ping.DeviceId = deviceID
		}
	}

	return deviceID, nil
}

// Telemetry API Handler - Process and store telemetry data via HTTP POST
func ProcessTelemetry(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("userID")
		if userID == "" {
			handlers.SendProtobufError(c, http.StatusUnauthorized, "missing authenticated user")
			return
		}

		// Read protobuf data from request body
		body, err := io.ReadAll(c.Request.Body)
		if err != nil {
			handlers.SendProtobufError(c, http.StatusBadRequest, "failed to read request body")
			return
		}

		pings, err := decodeTelemetryPings(body)
		if err != nil {
			handlers.SendProtobufError(c, http.StatusBadRequest, "failed to decode telemetry payload")
			return
		}

		deviceID, err := normalizePingsDeviceID(pings)
		if err != nil {
			handlers.SendProtobufError(c, http.StatusBadRequest, err.Error())
			return
		}

		log.Printf("[ProcessTelemetry] user=%s device=%s pings=%d", userID, deviceID, len(pings))

		// Process each ping in the batch
		processedPings := 0
		for _, ping := range pings {
			if err := processSinglePing(db, userID, ping); err != nil {
				log.Printf("[ProcessTelemetry] Failed to process ping for device %s: %v", ping.DeviceId, err)
				continue
			}
			processedPings++
		}

		handlers.SendProtobufResponse(c, http.StatusOK, &pb.TelemetryResponse{
			Message:        "Telemetry uploaded",
			ProcessedCount: int32(processedPings),
		})
	}
}

func processSinglePing(db *sql.DB, userID string, ping *pb.Ping) error {
	// Require a device ID; everything else (including GPS fix) is optional.
	if ping == nil || strings.TrimSpace(ping.GetDeviceId()) == "" {
		return nil
	}

	// Calculate RPM from gyroscope Z-axis (spin rate in deg/s)
	rpm := CalculateRPM(float64(ping.GyroZ))

	wobble := math.Abs(float64(ping.AccelZ) - 1.0)

	hasGpsFix := ping.GetLat() != 0 || ping.GetLon() != 0
	var lat, lon, alt sql.NullFloat64
	if hasGpsFix {
		lat = sql.NullFloat64{Float64: ping.GetLat(), Valid: true}
		lon = sql.NullFloat64{Float64: ping.GetLon(), Valid: true}
		alt = sql.NullFloat64{Float64: ping.GetAlt(), Valid: true}
	}

	// Firmware sets Timestamp = millis() (milliseconds since boot), not a
	// Unix timestamp.  Use the server receive time for the DB row so that
	// timestamps are always in a meaningful absolute time domain.
	_, err := db.Exec(`
		INSERT INTO telemetry (
			device_id,
			user_id,
			timestamp,
			latitude,
			longitude,
			altitude,
			accel_x,
			accel_y,
			accel_z,
			rpm,
			hdop,
			sats,
			speed,
			battery_level,
			frequency_noise
		)
		VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
		)`,
		ping.GetDeviceId(), userID,
		time.Now(),
		lat, lon, alt,
		ping.GetAccelX(), ping.GetAccelY(), ping.GetAccelZ(),
		rpm, ping.GetHdop(), ping.GetSats(), ping.GetSpeedMps(), ping.GetBattPct(), wobble,
	)

	return err
}

// Get Telemetry Data - Retrieve recent telemetry for a device
func GetTelemetry(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("userID")
		if userID == "" {
			handlers.SendProtobufError(c, http.StatusUnauthorized, "missing authenticated user")
			return
		}

		deviceId := c.Query("device_id")
		if deviceId == "" {
			handlers.SendProtobufError(c, http.StatusBadRequest, "device_id parameter required")
			return
		}

		// Ownership gating intentionally disabled for telemetry fetch.
		// Device registration is handled at pairing/account-link time.

		// Get recent telemetry data (last 100 points), returning all fields
		// so the frontend can display GPS quality (hdop/sats), battery, etc.
		rows, err := db.Query(`
			SELECT
				device_id,
				latitude,
				longitude,
				altitude,
				COALESCE(rpm, 0),
				COALESCE(frequency_noise, 0),
				COALESCE(hdop, 0),
				COALESCE(sats, 0),
				COALESCE(speed, 0),
				COALESCE(battery_level, 0),
				COALESCE(accel_x, 0),
				COALESCE(accel_y, 0),
				COALESCE(accel_z, 0),
				timestamp
			FROM telemetry
			WHERE user_id = $1 AND device_id = $2
			ORDER BY timestamp DESC
			LIMIT 100`, userID, deviceId)

		if err != nil {
			log.Printf("[GetTelemetry] Database query failed: %v", err)
			handlers.SendProtobufError(c, http.StatusInternalServerError, "Failed to fetch telemetry")
			return
		}
		defer rows.Close()

		var pings []*pb.Ping
		for rows.Next() {
			var rowDeviceId string
			var lat, lon, alt sql.NullFloat64
			var rpm, wobble, hdop, speed, accelX, accelY, accelZ float64
			var sats, battPct int
			var timestamp time.Time

			err := rows.Scan(
				&rowDeviceId, &lat, &lon, &alt,
				&rpm, &wobble, &hdop, &sats, &speed, &battPct,
				&accelX, &accelY, &accelZ,
				&timestamp,
			)
			if err != nil {
				log.Printf("[GetTelemetry] Row scan error: %v", err)
				continue
			}

			ping := &pb.Ping{
				DeviceId: rowDeviceId,
				Lat:      lat.Float64,
				Lon:      lon.Float64,
				Alt:      alt.Float64,
				SpeedMps: float32(speed),
				Hdop:     float32(hdop),
				Sats:     int32(sats),
				AccelX:   float32(accelX),
				AccelY:   float32(accelY),
				AccelZ:   float32(accelZ),
				BattPct:  int32(battPct),
				// Reconstruct gyro_z from stored rpm so the frontend derives
				// the same rpm value: |gyro_z| / 6 = rpm  ⟹  gyro_z = rpm * 6.
				GyroZ:     float32(rpm * 6.0),
				Timestamp: timestamp.UnixMilli(),
			}
			pings = append(pings, ping)
		}

		if err := rows.Err(); err != nil {
			log.Printf("[GetTelemetry] Row iteration failed: %v", err)
			handlers.SendProtobufError(c, http.StatusInternalServerError, "Failed to fetch telemetry")
			return
		}

		// Return as SyncBatch (repeated Ping) so the frontend receives the
		// full hardware.proto Ping message including hdop, sats, and batt_pct.
		resp := &pb.SyncBatch{Pings: pings}
		handlers.SendProtobufResponse(c, http.StatusOK, resp)
	}
}

var (
	GlobalDB     *sql.DB
	GlobalRouter *gin.Engine
)

func init() {
	loadDotEnvFiles()

	dbUrl := os.Getenv("DATABASE_URL")
	if dbUrl == "" {
		log.Println("DATABASE_URL not set, DB features might fail if they require it")
	} else {
		log.Println("Found DATABASE_URL, attempting connection...")
	}

	var err error
	GlobalDB, err = sql.Open("postgres", normalizeDatabaseURL(dbUrl))
	if err != nil {
		log.Fatal(err)
	}

	pingCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := GlobalDB.PingContext(pingCtx); err != nil {
		log.Printf("database ping failed: %v", err)
	}

	gin.SetMode(gin.ReleaseMode)
	GlobalRouter = gin.Default()
	GlobalRouter.SetTrustedProxies([]string{"127.0.0.1", "localhost"})

	// CORS middleware for local frontend development with an explicit allow list
	GlobalRouter.Use(func(c *gin.Context) {
		allowedOrigins := map[string]bool{
			"http://localhost:3000": true,
			"http://127.0.0.1:3000": true,
		}

		origin := c.GetHeader("Origin")
		if origin != "" && allowedOrigins[origin] {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Vary", "Origin")
			c.Header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			c.Header("Access-Control-Allow-Headers", "Content-Type, X-User-ID, Authorization")
			c.Header("Access-Control-Allow-Credentials", "true")
		}

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusOK)
			return
		}
		c.Next()
	})

	// Protobuf Content-Type Middleware
	GlobalRouter.Use(func(c *gin.Context) {
		if c.GetHeader("Content-Type") == "application/protobuf" {
			c.Header("Content-Type", "application/protobuf")
		}
		c.Next()
	})

	jwtSecret := os.Getenv("JWT_SECRET")
	allowInsecureUserID := strings.EqualFold(os.Getenv("ALLOW_INSECURE_X_USER_ID"), "true")

	// Auth middleware for Bearer JWT with optional local insecure fallback
	authMiddleware := func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader != "" {
			if jwtSecret == "" {
				handlers.SendProtobufError(c, http.StatusUnauthorized, "JWT authentication is not configured")
				return
			}

			claims, err := parseAndVerifyBearerToken(authHeader, jwtSecret)
			if err != nil {
				handlers.SendProtobufError(c, http.StatusUnauthorized, "invalid bearer token")
				return
			}

			userID := extractUserIDFromClaims(claims)
			if strings.TrimSpace(userID) == "" {
				handlers.SendProtobufError(c, http.StatusUnauthorized, "token missing user identifier")
				return
			}

			c.Set("userID", userID)
			c.Next()
			return
		}

		if allowInsecureUserID {
			userID := strings.TrimSpace(c.GetHeader("X-User-ID"))
			if userID == "" {
				handlers.SendProtobufError(c, http.StatusUnauthorized, "missing X-User-ID in insecure mode")
				return
			}
			c.Set("userID", userID)
			c.Next()
			return
		}

		handlers.SendProtobufError(c, http.StatusUnauthorized, "missing bearer token")
	}

	// REST API Routes for Sessions
	api := GlobalRouter.Group("/api/v1")
	api.Use(authMiddleware)
	{
		// Session management
		api.POST("/sessions", handlers.CreateSession(GlobalDB))
		api.PATCH("/sessions/:id/end", handlers.EndSession(GlobalDB))
		api.GET("/sessions/active", handlers.GetActiveSessions(GlobalDB))

		// Disc management
		api.GET("/discs", handlers.GetUserDiscs(GlobalDB))
		api.POST("/discs", handlers.CreateDisc(GlobalDB))
		api.DELETE("/discs/:id", handlers.DeleteDisc(GlobalDB))

		// Throw management
		api.GET("/throws", handlers.ListThrows(GlobalDB))
		api.POST("/throws", handlers.SaveThrow(GlobalDB))
		api.DELETE("/throws/:id", handlers.DeleteThrow(GlobalDB))

		// User settings
		api.GET("/user/settings", handlers.GetUserSettings(GlobalDB))
		api.PATCH("/user/settings", handlers.UpdateUserSettings(GlobalDB))

		// Telemetry endpoints
		api.POST("/telemetry/upload", ProcessTelemetry(GlobalDB))
		api.GET("/telemetry", GetTelemetry(GlobalDB))
	}
}

// Handler is the Vercel serverless function entrypoint.
func Handler(w http.ResponseWriter, r *http.Request) {
	GlobalRouter.ServeHTTP(w, r)
}
