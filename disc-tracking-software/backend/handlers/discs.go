package handlers

import (
	"database/sql"
	"net/http"
	"project2/disc-tracking-software/backend/pb"

	"github.com/gin-gonic/gin"
)

// GetUserDiscs retrieves all discs belonging to a user
func GetUserDiscs(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		_ = c.GetString("userID")

		// TODO: Implement disc retrieval logic
		resp := &pb.GetUserDiscsResponse{
			Discs: []*pb.DiscResponse{},
		}
		SendProtobufResponse(c, http.StatusOK, resp)
	}
}

// CreateDisc creates a new disc entry
func CreateDisc(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("userID")

		var req pb.DiscRequest
		if err := c.BindJSON(&req); err != nil {
			SendProtobufError(c, http.StatusBadRequest, "invalid request")
			return
		}

		// TODO: Implement disc creation logic
		resp := &pb.DiscResponse{
			Id:     "", // Generated ID
			UserId: userID,
			Name:   req.Name,
		}
		SendProtobufResponse(c, http.StatusCreated, resp)
	}
}

// DeleteDisc removes a disc entry
func DeleteDisc(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		_ = c.GetString("userID")
		discID := c.Param("id")

		if discID == "" {
			SendProtobufError(c, http.StatusBadRequest, "disc_id required")
			return
		}

		// TODO: Implement disc deletion logic
		SendProtobufResponse(c, http.StatusOK, &pb.DeleteDiscResponse{
			Message: "Disc deleted successfully",
			Id:      discID,
		})
	}
}
