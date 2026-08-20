package handlers

import (
	"database/sql"
	"net/http"
	"project2/disc-tracking-software/backend/pb"

	"github.com/gin-gonic/gin"
)

// CreateSession creates a new tracking session
func CreateSession(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("userID")

		var req pb.SessionRequest
		if err := c.BindJSON(&req); err != nil {
			SendProtobufError(c, http.StatusBadRequest, "invalid request")
			return
		}

		// TODO: Implement session creation logic
		resp := &pb.SessionResponse{
			Id:     "", // Generated ID
			UserId: userID,
			Status: "active",
		}
		SendProtobufResponse(c, http.StatusCreated, resp)
	}
}

// EndSession terminates an active tracking session
func EndSession(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		_ = c.GetString("userID")
		sessionID := c.Param("id")

		if sessionID == "" {
			SendProtobufError(c, http.StatusBadRequest, "session_id required")
			return
		}

		// TODO: Implement session termination logic
		resp := &pb.EndSessionResponse{
			Message: "Session ended successfully",
		}
		SendProtobufResponse(c, http.StatusOK, resp)
	}
}

// GetActiveSessions retrieves all active sessions for a user
func GetActiveSessions(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		_ = c.GetString("userID")

		// TODO: Implement active sessions retrieval logic
		resp := &pb.GetActiveSessionsResponse{
			Sessions: []*pb.SessionResponse{},
		}
		SendProtobufResponse(c, http.StatusOK, resp)
	}
}
