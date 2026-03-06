package main

import (
	"database/sql" //placeholder before hooking up to actual database, but calls will be very similar in their place here
	"encoding/json"
	"io"
	"log"
	"math"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"google.golang.org/protobuf/proto"

	"project2/disc-tracking-software/pb"
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
	StartPos pb.Ping
	EndPos pb.Ping
	MaxRPM float64
	IsActive bool
}

var activeSessions = make(map[string]*ThrowSession)

func DetectThrowPhases(ping *pb.Ping, currentRPM float64, hub *Hub) {
	session, exists := activeSessions[ping.DeviceId]

	// INIT DETECTION: Launch 
	// Trigger: RPM jumps from 0 to > 400 AND G-Force > 5G

	if !exists && currentRPM > 400 {
		activeSessions[ping.DeviceId] = &ThrowSession{
			StartTime: time.Unix(ping.Timestamp/1000, 0),
			StartPos:  *ping,
			MaxRPM:    currentRPM,
			IsActive:  true,
		}
		broadcastStatus(hub, ping.DeviceId, "IN_FLIGHT")
		return
	}

	if exists && session.IsActive {
		// Update Max Stats
		if currentRPM > session.MaxRPM {
			session.MaxRPM = currentRPM
		}

		// FINAL DETECTION: Landing
		// Trigger: RPM drops significantly AND Z-axis stabilizes at ~1G

		if currentRPM < 100 && math.Abs(float64(ping.AccelZ)-1.0) < 0.2 {
			session.EndPos = *ping
			session.IsActive = false

			// Finalize Throw Data
			finalizeThrow(session)
			broadcastStatus(hub, ping.DeviceId, "LANDED")

			// Clean up session
			delete(activeSessions, ping.DeviceId)

			// to avoid a fake throw by someone accidentally tripping sensor
			duration := session.EndPos.Timestamp - session.StartPos.Timestamp
			if float64(duration)/1000.0 < 1.5 {
				// Discard data - it wasn't a real throw
				return
			}
		}
	}
}

// finalizeThrow handles any final processing or storage of a completed throw session.

func finalizeThrow(session *ThrowSession) {
	// Placeholder: Implement logic to persist throw data or trigger analytics.
	// For now, just log the throw session.
	log.Printf("Finalized throw: start=%v end=%v maxRPM=%.2f", session.StartPos, session.EndPos, session.MaxRPM)
}

// broadcastStatus sends a status update to all connected clients via the hub.

func broadcastStatus(hub *Hub, deviceId string, status string) {
	update := map[string]interface{}{
		"device_id": deviceId,
		"status":    status,
	}
	payload, _ := json.Marshal(update)
	hub.broadcast <- payload
}


//------------------------------------------


// ValidatePing checks if the GPS data is high-quality enough to record
func ValidatePing(p *pb.Ping) bool {

	// HDOP < 2.0 is excellent, > 5.0 is junk. 
	// We ignore anything above 4.0 to prevent "jitter"

	if p.Hdop > 4.0 || p.Sats < 5 {
		return false
	}
	return true
}

// ProcessSpatialData handles the "Heavy Lifting"
func ProcessSpatialData(db *sql.DB, p *pb.Ping, teeLat, teeLon, teeAlt float64) (float64, bool) {

	// Using PostGIS for the surface distance and manual math for the Z-axis
	var surfaceDist float64
	query := `SELECT ST_DistanceSphere(
		ST_MakePoint($1, $2), 
		ST_MakePoint($3, $4)
	)`
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
	timeDelta := float64(p2.Timestamp - p1.Timestamp) / 1000.0 // seconds
	
	// Distance between two points
	dist := Haversine(p1.Lat, p1.Lon, p2.Lat, p2.Lon) 
	
	return dist / timeDelta // Result in meters per second
}

// Haversine calculates the great-circle distance between two points on the Earth.
func Haversine(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371000 // Earth radius in meters
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


//----------------------------------------------------------------------
//buffered channels to handle binary package ingestion

var ping_queue = make(chan *pb.Ping, 5000)

func main() {
	hub := NewHub()
	go hub.Run()

	r := gin.Default()

	r.GET("/ws", func(c *gin.Context) {
		conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			log.Println(err)
			return
		}
		hub.register <- conn
	})

	go db_worker() //set backgorund go routine

	r.POST("/api/v1/sync", func(c *gin.Context) {
		body, err := io.ReadAll(c.Request.Body)
		
		if err != nil { //read raw binary stream
			c.AbortWithStatus(http.StatusBadRequest)
			return
		}

		//throw binaries into our buf boy (Protobuf) struct
		var batch pb.SyncBatch
		if err := proto.Unmarshal(body, &batch); err != nil {
			c.AbortWithStatus(http.StatusBadRequest)
			return
		}

		for _, ping := range batch.GetPings() { //send ping in background queue
			ping_queue <- ping

			payload, _ := json.Marshal(ping) //Convert protbuf to JSON formatting
			hub.broadcast <- payload
		}

		c.Status(http.StatusOK)
	})

	log.Println("Server running on :8080")
	r.Run(":8080")
}

func db_worker() {
	panic("unimplemented")
}

// CONSTANT: The distance from the center of the disc to IMU chip.
// FOR REFERENCE: If the chip is 10mm from the center, this is shown as 0.01

const SensorRadiusMeters = 0.008 // Example: 8mm

func dbWorker(db *sql.DB, hub *Hub, queue chan *pb.Ping) {
	for ping := range queue {
		// 1. Calculate RPM from Centripetal Acceleration
		// Formula: w = sqrt(a/r) | RPM = (w * 60) / 2pi
		resultantG := math.Sqrt(math.Pow(float64(ping.AccelX), 2) + math.Pow(float64(ping.AccelY), 2))
		accelMS2 := resultantG * 9.80665
		
		var rpm float64 = 0
		if resultantG > 0.1 { // Avoid division by zero/noise
			omega := math.Sqrt(accelMS2 / SensorRadiusMeters)
			rpm = (omega * 60) / (2 * math.Pi)
		}

		// 2. Measure Wobble (Z-axis variance)
		wobble := math.Abs(float64(ping.AccelZ))

		// 3. Persist to PostGIS
		_, err := db.Exec(`
			INSERT INTO throws (device_id, location, hdop, rpm, wobble_g)
			VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3, $4), 4326), $5, $6, $7)`,
			ping.DeviceId, ping.Lon, ping.Lat, ping.Alt, ping.Hdop, rpm, wobble,
		)

		if err == nil {
			// 4. Broadcast the calculated data to Next.js via WebSocket
			// We create a combined object so the frontend gets the RPM instantly
			update := map[string]interface{}{
				"device_id": ping.DeviceId,
				"lat":       ping.Lat,
				"lon":       ping.Lon,
				"rpm":       math.Round(rpm),
				"wobble":    wobble,
			}
			payload, _ := json.Marshal(update)
			hub.broadcast <- payload
		}
	}
}
