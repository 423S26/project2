package handlers

import (
	"database/sql"
	"net/http"
	"project2/disc-tracking-software/backend/pb"

	"github.com/gin-gonic/gin"
)

// ListThrows retrieves all throws for a user or session
func ListThrows(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		_ = c.GetString("userID")

		// TODO: Implement throws list logic
		resp := &pb.GetThrowsResponse{
			Throws: []*pb.ThrowListItem{},
		}
		SendProtobufResponse(c, http.StatusOK, resp)
	}
}

// SaveThrow records a new throw
func SaveThrow(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		_ = c.GetString("userID")

		var req pb.ThrowRequest
		if err := c.BindJSON(&req); err != nil {
			SendProtobufError(c, http.StatusBadRequest, "invalid request")
			return
		}

		// TODO: Implement throw save logic
		resp := &pb.ThrowResponse{
			Message: "Throw saved successfully",
			Id:      "", // Generated ID
		}
		SendProtobufResponse(c, http.StatusCreated, resp)
	}
}

// DeleteThrow removes a throw record
func DeleteThrow(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		_ = c.GetString("userID")
		throwID := c.Param("id")

		if throwID == "" {
			SendProtobufError(c, http.StatusBadRequest, "throw_id required")
			return
		}

		// TODO: Implement throw deletion logic
		SendProtobufResponse(c, http.StatusOK, &pb.ThrowResponse{
			Message: "Throw deleted successfully",
			Id:      throwID,
		})
	}
}
