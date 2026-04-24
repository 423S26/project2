package main

import (
	"database/sql"
	"io"
	"log"
	"net/http"
	"time"

	"project2/disc-tracking-software/pb"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Session API Handlers

func CreateSession(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("userID") // Set by auth middleware
		if userID == "" {
			sendProtobufError(c, http.StatusUnauthorized, "Unauthorized")
			return
		}

		// Read protobuf data from request body
		body, err := io.ReadAll(c.Request.Body)
		if err != nil {
			sendProtobufError(c, http.StatusBadRequest, "Failed to read request body")
			return
		}

		req := &pb.SessionRequest{}
		if err := proto.Unmarshal(body, req); err != nil {
			sendProtobufError(c, http.StatusBadRequest, "Failed to unmarshal protobuf")
			return
		}

		if req.DeviceId == "" {
			sendProtobufError(c, http.StatusBadRequest, "device_id is required")
			return
		}

		sessionID := uuid.New().String()
		now := time.Now()

		_, err = db.Exec(`
			INSERT INTO sessions (id, user_id, device_id, status, started_at, notes)
			VALUES ($1, $2, $3, $4, $5, $6)
		`, sessionID, userID, req.DeviceId, "active", now, req.Notes)

		if err != nil {
			log.Printf("[CreateSession] Database insert failed: %v", err)
			sendProtobufError(c, http.StatusInternalServerError, "Failed to create session")
			return
		}

		resp := &pb.SessionResponse{
			Id:         sessionID,
			UserId:     userID,
			DeviceId:   req.DeviceId,
			Status:     "active",
			StartedAt:  timestamppb.New(now),
			ThrowCount: 0,
			CreatedAt:  timestamppb.New(now),
		}

		sendProtobufResponse(c, http.StatusCreated, resp)
	}
}

func EndSession(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("userID")
		if userID == "" {
			sendProtobufError(c, http.StatusUnauthorized, "Unauthorized")
			return
		}

		sessionID := c.Param("id")
		endedAt := time.Now()

		_, err := db.Exec(`
			UPDATE sessions
			SET status = $1, ended_at = $2
			WHERE id = $3 AND user_id = $4
		`, "ended", endedAt, sessionID, userID)

		if err != nil {
			sendProtobufError(c, http.StatusInternalServerError, "Failed to end session")
			return
		}

		resp := &pb.EndSessionResponse{
			Message: "Session ended",
			EndedAt: timestamppb.New(endedAt),
		}

		sendProtobufResponse(c, http.StatusOK, resp)
	}
}

func GetActiveSessions(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("userID")
		if userID == "" {
			sendProtobufError(c, http.StatusUnauthorized, "Unauthorized")
			return
		}

		rows, err := db.Query(`
			SELECT id, user_id, device_id, status, started_at, ended_at, throw_count, created_at
			FROM sessions
			WHERE user_id = $1 AND status = 'active'
			ORDER BY started_at DESC
		`, userID)

		if err != nil {
			log.Printf("[GetActiveSessions] Database query failed: %v", err)
			sendProtobufError(c, http.StatusInternalServerError, "Failed to fetch sessions")
			return
		}
		defer rows.Close()

		var sessions []*pb.SessionResponse
		for rows.Next() {
			var id, userId, deviceId, status string
			var startedAt, createdAt time.Time
			var endedAt *time.Time
			var throwCount int

			err := rows.Scan(
				&id, &userId, &deviceId, &status,
				&startedAt, &endedAt, &throwCount, &createdAt,
			)
			if err != nil {
				log.Printf("Error scanning row: %v", err)
				continue
			}

			session := &pb.SessionResponse{
				Id:         id,
				UserId:     userId,
				DeviceId:   deviceId,
				Status:     status,
				StartedAt:  timestamppb.New(startedAt),
				ThrowCount: int32(throwCount),
				CreatedAt:  timestamppb.New(createdAt),
			}

			if endedAt != nil {
				session.EndedAt = timestamppb.New(*endedAt)
			}

			sessions = append(sessions, session)
		}

		resp := &pb.GetActiveSessionsResponse{
			Sessions: sessions,
		}

		sendProtobufResponse(c, http.StatusOK, resp)
	}
}

// Disc API Handlers

func GetUserDiscs(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("userID")
		if userID == "" {
			sendProtobufError(c, http.StatusUnauthorized, "Unauthorized")
			return
		}

		rows, err := db.Query(`
			SELECT id, user_id, name, type, weight, color, created_at
			FROM disc_table
			WHERE user_id = $1
			ORDER BY created_at DESC
		`, userID)

		if err != nil {
			log.Printf("[GetUserDiscs] Database query failed: %v", err)
			sendProtobufError(c, http.StatusInternalServerError, "Failed to fetch discs")
			return
		}
		defer rows.Close()

		var discs []*pb.DiscResponse
		for rows.Next() {
			var id, userId, name, type_, color string
			var weight int
			var createdAt time.Time

			err := rows.Scan(
				&id, &userId, &name, &type_,
				&weight, &color, &createdAt,
			)
			if err != nil {
				log.Printf("Error scanning row: %v", err)
				continue
			}

			disc := &pb.DiscResponse{
				Id:        id,
				UserId:    userId,
				Name:      name,
				Type:      type_,
				Weight:    int32(weight),
				Color:     color,
				CreatedAt: timestamppb.New(createdAt),
			}

			discs = append(discs, disc)
		}

		resp := &pb.GetUserDiscsResponse{
			Discs: discs,
		}

		sendProtobufResponse(c, http.StatusOK, resp)
	}
}

func CreateDisc(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("userID")
		if userID == "" {
			sendProtobufError(c, http.StatusUnauthorized, "Unauthorized")
			return
		}

		// Read protobuf data from request body
		body, err := io.ReadAll(c.Request.Body)
		if err != nil {
			sendProtobufError(c, http.StatusBadRequest, "Failed to read request body")
			return
		}

		req := &pb.DiscRequest{}
		if err := proto.Unmarshal(body, req); err != nil {
			sendProtobufError(c, http.StatusBadRequest, "Failed to unmarshal protobuf")
			return
		}

		if req.Name == "" || req.Type == "" || req.Color == "" {
			sendProtobufError(c, http.StatusBadRequest, "name, type, and color are required")
			return
		}

		if req.Weight < 100 || req.Weight > 250 {
			sendProtobufError(c, http.StatusBadRequest, "weight must be between 100 and 250")
			return
		}

		discID := uuid.New().String()
		now := time.Now()

		_, err = db.Exec(`
			INSERT INTO disc_table (id, user_id, name, type, weight, color, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
		`, discID, userID, req.Name, req.Type, req.Weight, req.Color, now)

		if err != nil {
			sendProtobufError(c, http.StatusInternalServerError, "Failed to create disc")
			return
		}

		resp := &pb.DiscResponse{
			Id:        discID,
			UserId:    userID,
			Name:      req.Name,
			Type:      req.Type,
			Weight:    req.Weight,
			Color:     req.Color,
			CreatedAt: timestamppb.New(now),
		}

		sendProtobufResponse(c, http.StatusCreated, resp)
	}
}

func DeleteDisc(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("userID")
		if userID == "" {
			sendProtobufError(c, http.StatusUnauthorized, "Unauthorized")
			return
		}

		discID := c.Param("id")

		_, err := db.Exec(`
			DELETE FROM disc_table
			WHERE id = $1 AND user_id = $2
		`, discID, userID)

		if err != nil {
			sendProtobufError(c, http.StatusInternalServerError, "Failed to delete disc")
			return
		}

		resp := &pb.DeleteDiscResponse{
			Message: "Disc deleted",
			Id:      discID,
		}

		sendProtobufResponse(c, http.StatusOK, resp)
	}
}

// Throw API Handler

func SaveThrow(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("userID")
		if userID == "" {
			sendProtobufError(c, http.StatusUnauthorized, "Unauthorized")
			return
		}

		// Read protobuf data from request body
		body, err := io.ReadAll(c.Request.Body)
		if err != nil {
			sendProtobufError(c, http.StatusBadRequest, "Failed to read request body")
			return
		}

		req := &pb.ThrowRequest{}
		if err := proto.Unmarshal(body, req); err != nil {
			sendProtobufError(c, http.StatusBadRequest, "Failed to unmarshal protobuf")
			return
		}

		if req.SessionId == "" || req.DiscId == "" {
			sendProtobufError(c, http.StatusBadRequest, "session_id and disc_id are required")
			return
		}

		throwID := uuid.New().String()
		now := time.Now()

		_, err = db.Exec(`
			INSERT INTO throws (
				id, user_id, session_id, disc_id, timestamp,
				tee_location, found_location, distance, max_rpm, exit_velocity,
				flight_time, state, is_ob, wobble_g, hdop, created_at
			) VALUES (
				$1, $2, $3, $4, $5,
				ST_SetSRID(ST_MakePoint($6, $7, $8), 4326),
				ST_SetSRID(ST_MakePoint($9, $10, $11), 4326),
				$12, $13, $14, $15, $16, $17, $18, $19, $20
			)
		`, throwID, userID, req.SessionId, req.DiscId, now,
			req.TeeLon, req.TeeLat, req.TeeAlt,
			req.FoundLon, req.FoundLat, req.FoundAlt,
			req.Distance, req.MaxRpm, req.ExitVelocity, req.FlightTime,
			req.State, req.IsOb, req.WobbleG, req.Hdop, now,
		)

		if err != nil {
			sendProtobufError(c, http.StatusInternalServerError, "Failed to save throw")
			return
		}

		resp := &pb.ThrowResponse{
			Message: "Throw saved",
			Id:      throwID,
		}

		sendProtobufResponse(c, http.StatusCreated, resp)
	}
}

func ListThrows(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("userID")
		if userID == "" {
			sendProtobufError(c, http.StatusUnauthorized, "Unauthorized")
			return
		}

		sessionID := c.Query("sessionId")

		baseQuery := `
			SELECT
				t.id,
				COALESCE(t.session_id::text, ''),
				COALESCE(s.notes, ''),
				COALESCE(d.name, 'Unknown Disc'),
				COALESCE(d.type, 'Unknown Type'),
				COALESCE(t.distance, 0),
				COALESCE(t.flight_time, 0),
				COALESCE(t.exit_velocity, 0),
				t.timestamp, COALESCE(t.max_rpm, 0)
			FROM throws t
			LEFT JOIN disc_table d ON d.id = t.disc_id
			LEFT JOIN sessions s ON s.id = t.session_id
			WHERE t.user_id = $1
		`

		var (
			rows *sql.Rows
			err  error
		)

		if sessionID != "" {
			rows, err = db.Query(baseQuery+" AND t.session_id = $2 ORDER BY t.timestamp DESC", userID, sessionID)
		} else {
			rows, err = db.Query(baseQuery+" ORDER BY t.timestamp DESC", userID)
		}

		if err != nil {
			sendProtobufError(c, http.StatusInternalServerError, "Failed to fetch throws")
			return
		}
		defer rows.Close()

		throws := make([]*pb.ThrowListItem, 0)
		for rows.Next() {
			var (
				id           string
				sessionID    string
				session      string
				discName     string
				discType     string
				distance     float64
				flightTime   float64
				exitVelocity float64
				timestamp    time.Time
				maxRpm       float64
			)

			if err := rows.Scan(
				&id,
				&sessionID,
				&session,
				&discName,
				&discType,
				&distance,
				&flightTime,
				&exitVelocity,
				&timestamp,
				&maxRpm,
			); err != nil {
				sendProtobufError(c, http.StatusInternalServerError, "Failed to read throw rows")
				return
			}

			if session == "" {
				session = "Session " + sessionID
			}

			throws = append(throws, &pb.ThrowListItem{
				Id:           id,
				SessionId:    sessionID,
				SessionLabel: session,
				DiscName:     discName,
				DiscType:     discType,
				Distance:     distance,
				FlightTime:   flightTime,
				ExitVelocity: exitVelocity,
				Timestamp:    timestamppb.New(timestamp.UTC()),
				MaxRpm:       &maxRpm,
			})
		}

		if err := rows.Err(); err != nil {
			sendProtobufError(c, http.StatusInternalServerError, "Failed during throw iteration")
			return
		}

		sendProtobufResponse(c, http.StatusOK, &pb.GetThrowsResponse{Throws: throws})
	}
}

func DeleteThrow(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("userID")
		if userID == "" {
			sendProtobufError(c, http.StatusUnauthorized, "Unauthorized")
			return
		}

		throwID := c.Param("id")
		if throwID == "" {
			sendProtobufError(c, http.StatusBadRequest, "Throw ID is required")
			return
		}

		result, err := db.Exec(`
			DELETE FROM throws
			WHERE id = $1 AND user_id = $2
		`, throwID, userID)
		if err != nil {
			sendProtobufError(c, http.StatusInternalServerError, "Failed to delete throw")
			return
		}

		rowsAffected, err := result.RowsAffected()
		if err != nil {
			sendProtobufError(c, http.StatusInternalServerError, "Failed to validate deletion")
			return
		}

		if rowsAffected == 0 {
			sendProtobufError(c, http.StatusNotFound, "Throw not found")
			return
		}

		sendProtobufResponse(c, http.StatusOK, &pb.ThrowResponse{Message: "Throw deleted", Id: throwID})
	}
}

// User Settings API Handlers

func GetUserSettings(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("userID")
		if userID == "" {
			sendProtobufError(c, http.StatusUnauthorized, "Unauthorized")
			return
		}

		var id, userId, preferredUnit string
		var bagLocationLat, bagLocationLon *float64
		var notificationsEnabled, autoSaveEnabled bool
		var updatedAt time.Time

		err := db.QueryRow(`
			SELECT id, user_id, bag_location_lat, bag_location_lon, preferred_unit, notifications_enabled, auto_save_enabled, updated_at
			FROM user_settings
			WHERE user_id = $1
		`, userID).Scan(
			&id, &userId, &bagLocationLat, &bagLocationLon,
			&preferredUnit, &notificationsEnabled, &autoSaveEnabled, &updatedAt,
		)

		if err == sql.ErrNoRows {
			// Create default settings
			settingsID := uuid.New().String()
			now := time.Now()
			db.Exec(`
				INSERT INTO user_settings (id, user_id, preferred_unit, notifications_enabled, auto_save_enabled)
				VALUES ($1, $2, $3, $4, $5)
			`, settingsID, userID, "meters", true, true)

			resp := &pb.UserSettingsResponse{
				Id:                   settingsID,
				UserId:               userID,
				PreferredUnit:        "meters",
				NotificationsEnabled: true,
				AutoSaveEnabled:      true,
				UpdatedAt:            timestamppb.New(now),
			}

			sendProtobufResponse(c, http.StatusOK, resp)
			return
		}

		if err != nil {
			sendProtobufError(c, http.StatusInternalServerError, "Failed to fetch settings")
			return
		}

		resp := &pb.UserSettingsResponse{
			Id:                   id,
			UserId:               userId,
			BagLocationLat:       bagLocationLat,
			BagLocationLon:       bagLocationLon,
			PreferredUnit:        preferredUnit,
			NotificationsEnabled: notificationsEnabled,
			AutoSaveEnabled:      autoSaveEnabled,
			UpdatedAt:            timestamppb.New(updatedAt),
		}

		sendProtobufResponse(c, http.StatusOK, resp)
	}
}

func UpdateUserSettings(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("userID")
		if userID == "" {
			sendProtobufError(c, http.StatusUnauthorized, "Unauthorized")
			return
		}

		// Read protobuf data from request body
		body, err := io.ReadAll(c.Request.Body)
		if err != nil {
			sendProtobufError(c, http.StatusBadRequest, "Failed to read request body")
			return
		}

		req := &pb.UserSettingsRequest{}
		if err := proto.Unmarshal(body, req); err != nil {
			sendProtobufError(c, http.StatusBadRequest, "Failed to unmarshal protobuf")
			return
		}

		now := time.Now()

		_, err = db.Exec(`
			INSERT INTO user_settings (user_id, bag_location_lat, bag_location_lon, preferred_unit, notifications_enabled, auto_save_enabled, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			ON CONFLICT (user_id) DO UPDATE SET
				bag_location_lat = COALESCE($2, user_settings.bag_location_lat),
				bag_location_lon = COALESCE($3, user_settings.bag_location_lon),
				preferred_unit = $4,
				notifications_enabled = $5,
				auto_save_enabled = $6,
				updated_at = $7
		`, userID, req.BagLocationLat, req.BagLocationLon, req.PreferredUnit, req.NotificationsEnabled, req.AutoSaveEnabled, now)

		if err != nil {
			sendProtobufError(c, http.StatusInternalServerError, "Failed to update settings")
			return
		}

		resp := &pb.EndSessionResponse{
			Message: "Settings updated",
			EndedAt: timestamppb.New(now),
		}

		sendProtobufResponse(c, http.StatusOK, resp)
	}
}

// Helper functions for protobuf serialization

func sendProtobufResponse(c *gin.Context, statusCode int, message proto.Message) {
	data, err := proto.Marshal(message)
	if err != nil {
		log.Printf("Error marshaling protobuf: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to marshal response"})
		return
	}

	c.Header("Content-Type", "application/protobuf")
	c.Data(statusCode, "application/protobuf", data)
}

func sendProtobufError(c *gin.Context, statusCode int, message string) {
	errResp := &pb.ErrorResponse{
		Error: message,
		Code:  int32(statusCode),
	}

	data, err := proto.Marshal(errResp)
	if err != nil {
		c.JSON(statusCode, gin.H{"error": message})
		return
	}

	c.Header("Content-Type", "application/protobuf")
	c.Data(statusCode, "application/protobuf", data)
}
