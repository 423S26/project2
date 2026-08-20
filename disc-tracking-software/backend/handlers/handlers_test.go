package handlers

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// SETTINGS TEST
func TestGetUserSettings(t *testing.T) {

	router := gin.New()
	router.GET("/user/settings", GetUserSettings(nil))

	req := httptest.NewRequest("GET", "/user/settings", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	
	if w.Code == http.StatusNotFound {
		t.Error("GettUserSettings returned 404 Not Found, expected 200 OK, HANDLER MAY NOT BE IMPLEMENTED!")
	}
}
// TestUpdateUserSettings tests the UpdateUserSettings handler || SETTINGS TEST
func TestUpdateUserSettings(t *testing.T) {

	router := gin.New()
	router.PATCH("/user/settings", UpdateUserSettings(nil))
	
	reqBody := []byte(`{"preferred_unit":"feet", "notifications_enabled":true}`)
	req := httptest.NewRequest("PATCH", "/user/settings", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code == http.StatusNotFound {
		t.Error("UpdateUserSettings returned 404 Not Found, expected 200 OK, HANDLER MAY NOT BE IMPLEMENTED!")
	}
}

// SESSIONS TESTS

func TestCreateSession(t *testing.T) {

	router := gin.New()
	router.POST("/sessions", CreateSession(nil))
	
	reqBody := []byte(`{"device_id":"test-device", "notes":"test session"}`)
	req := httptest.NewRequest("POST", "/sessions", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	
	if w.Code == http.StatusNotFound {
		t.Error("CreateSession returned 404 Not Found, expected 201 Created, HANDLER MAY NOT BE IMPLEMENTED!")
	}
}

func TestEndSession(t *testing.T) {
	router := gin.New()
	router.PATCH("/sessions/:id/end", EndSession(nil))

	req := httptest.NewRequest("PATCH", "/sessions/test-id/end", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code == http.StatusNotFound {
		t.Error("EndSession returned 404 Not Found, expected 200 OK, HANDLER MAY NOT BE IMPLEMENTED!")
	}
}

func TestActiveSessions(t *testing.T) {
	router := gin.New()
	router.GET("/sessions/active", GetActiveSessions(nil))
	
	req := httptest.NewRequest("GET", "/sessions/active", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	
	if w.Code == http.StatusNotFound {
		t.Error("GetActiveSessions handler not implemented, returned 404 Not Found, expected 200 OK!")
	}
}

// DISC TESTS

func TestGetUserDiscs(t *testing.T) {
	router := gin.New()
	router.GET("/discs", GetUserDiscs(nil))

	req := httptest.NewRequest("GET", "/discs", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code == http.StatusNotFound {
		t.Error("GetUserDiscs handler not implemented, returned 404 Not Found, expected 200 OK")
	}
}

func TestCreateDisc(t *testing.T) {
	router := gin.New()
	router.POST("/discs", CreateDisc(nil))
	reqBody := []byte(`{"name":"Test Disc", "type":"Driver", "brand":"Test Brand", "weight":170}`)
	req := httptest.NewRequest("POST", "/discs", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code == http.StatusNotFound {
		t.Error("CreateDisc handler not implemented, returned 404 Not Found, expected 201 Created")
	}
}

func TestDeleteDisc(t *testing.T) {
	router := gin.New()
	router.DELETE("/discs/:id", DeleteDisc(nil))

	req := httptest.NewRequest("DELETE", "/discs/test-id", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code == http.StatusNotFound {
		t.Error("DeleteDisc handler not implemented, returned 404 Not Found, expected 200 OK")
	}
}

//THROWS TESTS

func TestListThrows(t *testing.T) {
	router := gin.New()
	router.GET("/throws", ListThrows(nil))

	req := httptest.NewRequest("GET", "/throws", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code == http.StatusNotFound {
		t.Error("ListThrows handler not implemented, returned 404 Not Found, expected 200 OK")
	}
}

func TestSaveThrow(t *testing.T) {
	router := gin.New()
	router.POST("/throws", SaveThrow(nil))

	reqBody := []byte(`{"session_id":"test-session", "disc_id":"test-disc", "distance":300}`)
	req := httptest.NewRequest("POST", "/throws", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code == http.StatusNotFound {
		t.Error("SaveThrow handler not implemented, returned 404 Not Found, expected 201 Created")
	}
}

func TestDeleteThrow(t *testing.T) {
	router := gin.New()
	router.DELETE("/throws/:id", DeleteThrow(nil))

	req := httptest.NewRequest("DELETE", "/throws/test-id", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code == http.StatusNotFound {
		t.Error("DeleteThrow handler not implemented, returned 404 Not Found, expected 200 OK")
	}
}
