//NOTE: UNIT TESTS ARE IN A SEPARATE FILE (main_test.go) TO AVOID IMPORT CYCLES WITH THE PROTOBUF STRUCTS
//NOTE: ASSERTS WILL BE IMPLEMENTED INLINE
//NOTE: Telemetry ingestion uses batched HTTP POST uploads

package main

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
	"project2/disc-tracking-software/handlers"
	"project2/disc-tracking-software/pb"
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

type DiscState int

const (
	StateIdle DiscState = iota
	StateInFlight
	StateImpacted
)

type ThrowSession struct {
	StartTime time.Time
	StartPos  *pb.Ping
	EndPos    *pb.Ping
	MaxRPM    float64
	IsActive  bool
}

var (
	activeSessions = make(map[string]*ThrowSession)
)

type AuthClaims struct {
	Sub    string `json:"sub"`
	UserID string `json:"user_id"`
	Exp    int64  `json:"exp"`
	Iat    int64  `json:"iat"`
	Iss    string `json:"iss"`
	Aud    string `json:"aud"`
}

//------------------------------------------

func ValidatePing(p *pb.Ping) bool {
	// HDOP < 2.0 is excellent, > 5.0 is junk.
	// We ignore anything above 4.0 to prevent "jitter"
	if p == nil || p.Hdop > 4.0 || p.Sats < 5 {
		return false
	}
	return true
}

func ProcessSpatialData(db *sql.DB, p *pb.Ping, teeLat, teeLon, teeAlt float64) (float64, bool) {

	// Using PostGIS for the surface distance and manual math for the Z-axis
	var surfaceDist float64
	query := `SELECT ST_DistanceSphere(
		ST_MakePoint($1, $2), 
		ST_MakePoint($3, $4)
	)`
	if p.Lon == 0 && p.Lat == 0 {
		return 0, false
	}
	db.QueryRow(query, teeLon, teeLat, p.Lon, p.Lat).Scan(&surfaceDist)

	verticalDist := p.Alt - teeAlt
	totalDist := math.Sqrt(math.Pow(surfaceDist, 2) + math.Pow(verticalDist, 2))

	// OB (Out of Bounds) Check via Geofencing
	var isOB bool
	obQuery := `SELECT EXISTS (
		SELECT 1 FROM course_obstacles 
		WHERE ST_Intersects(boundary, ST_SetSRID(ST_MakePoint($1, $2), 4326))
	)`
	db.QueryRow(obQuery, p.Lon, p.Lat).Scan(&isOB)

	return totalDist, isOB
}

func CalculateExitVelocity(p1, p2 *pb.Ping) float64 {
	timeDelta := float64(p2.Timestamp-p1.Timestamp) / 1000.0 // seconds
	if timeDelta <= 0 {
		return 0
	}

	// Distance between two points
	dist := Haversine(p1.GetLat(), p1.GetLon(), p2.GetLat(), p2.GetLon())

	return dist / timeDelta
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

// CalculateRPM derives RPM from gyroscope Z-axis angular velocity (deg/s).
// The gyro Z-axis measures spin rate around the disc's vertical axis.
// At rest gyro_z ≈ 0 so RPM ≈ 0 — unlike the old centripetal-accel formula
// which falsely read ~170 RPM from gravity leaking into accel X/Y.
func CalculateRPM(gyroZDegPerSec float64) float64 {
	// 1 RPM = 6 deg/s  (360 deg / 60 s)
	rpm := math.Abs(gyroZDegPerSec) / 6.0
	// Suppress sensor noise — anything below ~5 RPM (30 deg/s) is drift
	if rpm < 5 {
		return 0
	}
	return rpm
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

func verifyDeviceOwnership(db *sql.DB, userID, deviceID string) (bool, error) {
	var owned bool
	err := db.QueryRow(`
		SELECT EXISTS (
			SELECT 1
			FROM sessions
			WHERE user_id = $1 AND device_id = $2
		)
	`, userID, deviceID).Scan(&owned)
	if err != nil {
		return false, err
	}
	return owned, nil
}

func calculateTelemetrySummary(pings []*pb.Ping) (float64, float64, float64) {
	if len(pings) == 0 {
		return 0, 0, 0
	}

	var totalDistanceMeters float64
	var maxRPM float64
	for i, ping := range pings {
		rpm := CalculateRPM(float64(ping.GetGyroZ()))
		if rpm > maxRPM {
			maxRPM = rpm
		}

		if i == 0 {
			continue
		}

		prev := pings[i-1]
		totalDistanceMeters += Haversine(
			prev.GetLat(),
			prev.GetLon(),
			ping.GetLat(),
			ping.GetLon(),
		)
	}

	first := pings[0]
	last := pings[len(pings)-1]
	horizontalMeters := Haversine(first.GetLat(), first.GetLon(), last.GetLat(), last.GetLon())
	verticalMeters := last.GetAlt() - first.GetAlt()
	releaseAngle := 0.0
	if horizontalMeters > 0 {
		releaseAngle = math.Atan2(verticalMeters, horizontalMeters) * (180.0 / math.Pi)
	}

	const metersToFeet = 3.28084
	return totalDistanceMeters * metersToFeet, releaseAngle, maxRPM
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

		var batch pb.SyncBatch
		if err := proto.Unmarshal(body, &batch); err != nil {
			handlers.SendProtobufError(c, http.StatusBadRequest, "failed to unmarshal protobuf")
			return
		}

		if len(batch.GetPings()) == 0 {
			handlers.SendProtobufError(c, http.StatusBadRequest, "batch contains no pings")
			return
		}

		deviceID := strings.TrimSpace(batch.GetPings()[0].GetDeviceId())
		if deviceID == "" {
			handlers.SendProtobufError(c, http.StatusBadRequest, "first ping is missing device_id")
			return
		}

		owned, err := verifyDeviceOwnership(db, userID, deviceID)
		if err != nil {
			log.Printf("[ProcessTelemetry] ownership query failed: %v", err)
			handlers.SendProtobufError(c, http.StatusInternalServerError, "failed to validate device ownership")
			return
		}
		if !owned {
			handlers.SendProtobufError(c, http.StatusForbidden, "user does not own device")
			return
		}

		// Process each ping in the batch
		processedPings := 0
		for _, ping := range batch.GetPings() {
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

// Process a single ping and store telemetry data
func processSinglePing(db *sql.DB, userID string, ping *pb.Ping) error {
	// Validate ping data
	if !ValidatePing(ping) {
		return nil // Skip invalid pings silently
	}
	if ping.Lat == 0 && ping.Lon == 0 {
		return nil
	}

	// Calculate RPM from gyroscope Z-axis (spin rate in deg/s)
	rpm := CalculateRPM(float64(ping.GyroZ))

	hdop := ping.Hdop

	// Wobble = deviation of accel_z from 1G (gravity). A perfectly flat
	// disc at rest reads ~1.0g on Z; tilt/wobble pushes that away from 1.0.
	wobble := math.Abs(float64(ping.AccelZ) - 1.0)

	// Persist raw telemetry samples for API fallback polling.
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
		time.Unix(ping.Timestamp/1000, 0),
		ping.GetLat(), ping.GetLon(), ping.GetAlt(),
		ping.GetAccelX(), ping.GetAccelY(), ping.GetAccelZ(),
		rpm, hdop, ping.GetSats(), ping.GetSpeedMps(), ping.GetBattPct(), wobble,
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

		owned, err := verifyDeviceOwnership(db, userID, deviceId)
		if err != nil {
			log.Printf("[GetTelemetry] ownership query failed: %v", err)
			handlers.SendProtobufError(c, http.StatusInternalServerError, "Failed to validate device ownership")
			return
		}
		if !owned {
			handlers.SendProtobufError(c, http.StatusForbidden, "user does not own device")
			return
		}

		// Get recent telemetry data (last 100 points)
		rows, err := db.Query(`
			SELECT
				device_id,
				latitude,
				longitude,
				altitude,
				COALESCE(rpm, 0),
				COALESCE(frequency_noise, 0),
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

		var telemetry []*pb.TelemetryUpdate
		for rows.Next() {
			var deviceId string
			var alt sql.NullFloat64
			var lat sql.NullFloat64
			var lon sql.NullFloat64
			var rpm, wobble float64
			var timestamp time.Time

			err := rows.Scan(&deviceId, &lat, &lon, &alt, &rpm, &wobble, &timestamp)
			if err != nil {
				log.Printf("[GetTelemetry] Row scan error: %v", err)
				continue
			}

			update := &pb.TelemetryUpdate{
				DeviceId:  deviceId,
				Lat:       lat.Float64,
				Lon:       lon.Float64,
				Rpm:       rpm,
				Wobble:    wobble,
				Timestamp: timestamp.Unix() * 1000, // Convert to milliseconds
			}
			if alt.Valid {
				altValue := alt.Float64
				update.Alt = &altValue
			}
			telemetry = append(telemetry, update)
		}

		if err := rows.Err(); err != nil {
			log.Printf("[GetTelemetry] Row iteration failed: %v", err)
			handlers.SendProtobufError(c, http.StatusInternalServerError, "Failed to fetch telemetry")
			return
		}

		resp := &pb.GetTelemetryResponse{
			Telemetry: telemetry,
		}

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

// CONSTANT: The distance from the center of the disc to IMU chip.
// FOR REFERENCE: If the chip is 10mm from the center, this is shown as 0.01

const SensorRadiusMeters = 0.008 // Example: 8mm
