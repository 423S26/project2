//NOTE: UNIT TESTS ARE IN A SEPARATE FILE (main_test.go) TO AVOID IMPORT CYCLES WITH THE PROTOBUF STRUCTS
//NOTE: ASSERTS WILL BE IMPLEMENTED INLINE
//NOTE: Refactored to use HTTP POST instead of WebSocket for telemetry

package main

import (
	"database/sql" //placeholder before hooking up to actual database, but calls will be very similar in their place here
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"project2/disc-tracking-software/pb"
	"time"

	"github.com/gin-gonic/gin"
	_ "github.com/lib/pq"
	"google.golang.org/protobuf/proto"
)

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

//------------------------------------------

func ValidatePing(p *pb.Ping) bool {
	// HDOP < 2.0 is excellent, > 5.0 is junk.
	// We ignore anything above 4.0 to prevent "jitter"

	if p.Hdop == nil || *p.Hdop > 4.0 || p.Satellites == nil || *p.Satellites < 5 {
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
	if p.Longitude == nil || p.Latitude == nil {
		return 0, false
	}
	db.QueryRow(query, teeLon, teeLat, *p.Longitude, *p.Latitude).Scan(&surfaceDist)

	if p.Altitude == nil {
		return 0, false
	}
	verticalDist := *p.Altitude - teeAlt
	totalDist := math.Sqrt(math.Pow(surfaceDist, 2) + math.Pow(verticalDist, 2))

	// OB (Out of Bounds) Check via Geofencing
	var isOB bool
	obQuery := `SELECT EXISTS (
		SELECT 1 FROM course_obstacles 
		WHERE ST_Intersects(boundary, ST_SetSRID(ST_MakePoint($1, $2), 4326))
	)`
	db.QueryRow(obQuery, *p.Longitude, *p.Latitude).Scan(&isOB)

	return totalDist, isOB
}

func CalculateExitVelocity(p1, p2 *pb.Ping) float64 {
	timeDelta := float64(p2.Timestamp-p1.Timestamp) / 1000.0 // seconds

	// Distance between two points
	dist := Haversine(p1.Lat, p1.Lon, p2.Lat, p2.Lon)

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

// This takes raw G-force data and the sensor's offset from center
func CalculateRPM(accelX, accelY float64, radiusMeters float64) float64 {

	//calculate resultant acceleration (Centripetal Force) via Pythagorem theorem combining x and y axes
	resultantG := math.Sqrt(math.Pow(accelX, 2) + math.Pow(accelY, 2))

	//convert Gs to m/s^2 (1G = 9.80665 m/s^2)
	accelMS2 := resultantG * 9.80665

	//solve for Omega (Angular Velocity in rad/s)
	//w = sqrt(a / r)
	omega := math.Sqrt(accelMS2 / radiusMeters)

	//convert Radians per Second to Revolutions per Minute
	//RPM = (w * 60) / (2 * Pi)
	rpm := (omega * 60) / (2 * math.Pi)

	return rpm
}

// Telemetry API Handler - Process and store telemetry data via HTTP POST
func ProcessTelemetry(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Read protobuf data from request body
		body, err := io.ReadAll(c.Request.Body)
		if err != nil {
			sendProtobufError(c, http.StatusBadRequest, "Failed to read request body")
			return
		}

		var batch pb.SyncBatch
		if err := proto.Unmarshal(body, &batch); err != nil {
			sendProtobufError(c, http.StatusBadRequest, "Failed to unmarshal protobuf")
			return
		}

		// Process each ping in the batch
		processedPings := 0
		for _, ping := range batch.GetPings() {
			if err := processSinglePing(db, ping); err != nil {
				log.Printf("[ProcessTelemetry] Failed to process ping for device %s: %v", ping.DeviceId, err)
				continue
			}
			processedPings++
		}

		resp := &pb.TelemetryResponse{
			Message:        "Telemetry processed",
			ProcessedCount: int32(processedPings),
		}

		sendProtobufResponse(c, http.StatusOK, resp)
	}
}

// Process a single ping and store telemetry data
func processSinglePing(db *sql.DB, ping *pb.Ping) error {
	// Validate ping data
	if !ValidatePing(ping) {
		return nil // Skip invalid pings silently
	}

	// Calculate RPM from Centripetal Acceleration
	resultantG := math.Sqrt(math.Pow(float64(ping.AccelX), 2) + math.Pow(float64(ping.AccelY), 2))
	accelMS2 := resultantG * 9.80665

	var rpm float64 = 0
	if resultantG > 0.1 { // Avoid division by zero/noise
		omega := math.Sqrt(accelMS2 / SensorRadiusMeters)
		rpm = (omega * 60) / (2 * math.Pi)
	}

	wobble := math.Abs(float64(ping.AccelZ))

	// Persist to PostGIS
	_, err := db.Exec(`
		INSERT INTO throws (device_id, location, hdop, rpm, wobble_g, timestamp)
		VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3, $4), 4326), $5, $6, $7, $8)`,
		ping.DeviceId, ping.Lon, ping.Lat, ping.Alt, ping.Hdop, rpm, wobble,
		time.Unix(ping.Timestamp/1000, 0),
	)

	return err
}

// Get Telemetry Data - Retrieve recent telemetry for a device
func GetTelemetry(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		deviceId := c.Query("device_id")
		if deviceId == "" {
			sendProtobufError(c, http.StatusBadRequest, "device_id parameter required")
			return
		}

		// Get recent telemetry data (last 100 points)
		rows, err := db.Query(`
			SELECT device_id, ST_X(location), ST_Y(location), ST_Z(location),
				   hdop, rpm, wobble_g, timestamp
			FROM throws
			WHERE device_id = $1
			ORDER BY timestamp DESC
			LIMIT 100`, deviceId)

		if err != nil {
			log.Printf("[GetTelemetry] Database query failed: %v", err)
			sendProtobufError(c, http.StatusInternalServerError, "Failed to fetch telemetry")
			return
		}
		defer rows.Close()

		var telemetry []*pb.TelemetryUpdate
		for rows.Next() {
			var deviceId string
			var lon, lat, alt, hdop, rpm, wobble float64
			var timestamp time.Time

			err := rows.Scan(&deviceId, &lon, &lat, &alt, &hdop, &rpm, &wobble, &timestamp)
			if err != nil {
				log.Printf("[GetTelemetry] Row scan error: %v", err)
				continue
			}

			update := &pb.TelemetryUpdate{
				DeviceId:  deviceId,
				Lat:       lat,
				Lon:       lon,
				Alt:       alt,
				Rpm:       rpm,
				Wobble:    wobble,
				Timestamp: timestamp.Unix() * 1000, // Convert to milliseconds
			}
			telemetry = append(telemetry, update)
		}

		resp := &pb.GetTelemetryResponse{
			Telemetry: telemetry,
		}

		sendProtobufResponse(c, http.StatusOK, resp)
	}
}

func main() {
	dbUrl := os.Getenv("DATABASE_URL")
	if dbUrl == "" {
		log.Println("DATABASE_URL not set, DB features might fail if they require it")
	} else {
		log.Println("Found DATABASE_URL, attempting connection...")
	}

	db, err := sql.Open("postgres", dbUrl)
	if err != nil {
		log.Fatal(err)
	}

	r := gin.Default()
	r.SetTrustedProxies([]string{"127.0.0.1", "localhost"})

	// CORS middleware for local frontend development with an explicit allow list
	r.Use(func(c *gin.Context) {
		allowedOrigins := map[string]bool{
			"http://localhost:3000": true,
			"http://127.0.0.1:3000": true,
		}

		origin := c.GetHeader("Origin")
		if origin != "" && allowedOrigins[origin] {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Vary", "Origin")
			c.Header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
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
	r.Use(func(c *gin.Context) {
		if c.GetHeader("Content-Type") == "application/protobuf" {
			c.Header("Content-Type", "application/protobuf")
		}
		c.Next()
	})

	// Auth middleware mock - In production, integrate with your actual auth system
	authMiddleware := func(c *gin.Context) {
		// Extract user ID from JWT or session - for now using a default for testing
		userID := c.GetHeader("X-User-ID")
		if userID == "" {
			userID = "test-user" // Remove this in production
		}
		c.Set("userID", userID)
		c.Next()
	}

	// REST API Routes for Sessions
	api := r.Group("/api/v1")
	api.Use(authMiddleware)
	{
		// Session management
		api.POST("/sessions", CreateSession(db))
		api.PATCH("/sessions/:id/end", EndSession(db))
		api.GET("/sessions/active", GetActiveSessions(db))

		// Disc management
		api.GET("/discs", GetUserDiscs(db))
		api.POST("/discs", CreateDisc(db))
		api.DELETE("/discs/:id", DeleteDisc(db))

		// Throw management
		api.POST("/throws", SaveThrow(db))

		// User settings
		api.GET("/user/settings", GetUserSettings(db))
		api.PATCH("/user/settings", UpdateUserSettings(db))

		// Telemetry endpoints
		api.POST("/telemetry", ProcessTelemetry(db))
		api.GET("/telemetry", GetTelemetry(db))
	}

	log.Println("Server running on :8080")
	r.Run(":8080")
}

// CONSTANT: The distance from the center of the disc to IMU chip.
// FOR REFERENCE: If the chip is 10mm from the center, this is shown as 0.01

const SensorRadiusMeters = 0.008 // Example: 8mm
