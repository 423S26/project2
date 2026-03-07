package main

import (
	"testing"
	"time"

	"project2/disc-tracking-software/pb" // Ensure this matches your module path
)

// Mock Hub for testing since DetectThrowPhases uses it
func setupTestHub() *Hub {
	return &Hub{
		broadcast: make(chan []byte, 10), // Buffered channel to prevent blocking
	}
}

func TestDetectThrowPhases(t *testing.T) {
	// Setup
	hub := setupTestHub()
	// Reset active sessions map
	activeSessions = make(map[string]*ThrowSession)

	deviceID := "device-123"

	// Test Case 1: Detect Launch
	// Trigger: RPM > 400
	pingLaunch := &pb.Ping{
		DeviceId:  deviceID,
		Timestamp: time.Now().UnixMilli(),
		AccelZ:    15.0, // High G
	}
	currentRPMLaunch := 500.0 // > 400

	DetectThrowPhases(pingLaunch, currentRPMLaunch, hub)

	session, exists := activeSessions[deviceID]
	if !exists {
		t.Errorf("Expected session to be created for launch, but it wasn't")
	}
	if !session.IsActive {
		t.Errorf("Expected session to be active, got inactive")
	}
	if session.MaxRPM != currentRPMLaunch {
		t.Errorf("Expected MaxRPM to be %f, got %f", currentRPMLaunch, session.MaxRPM)
	}

	// Read from channel to clear it (simulating broadcast)
	select {
	case msg := <-hub.broadcast:
		// Optional: Verify message content if needed
		_ = msg
	default:
		t.Errorf("Expected broadcast message on launch, got none")
	}

	// Test Case 2: Update Max RPM
	// RPM increases
	pingUpdate := &pb.Ping{
		DeviceId:  deviceID,
		Timestamp: time.Now().UnixMilli(),
		AccelZ:    5.0,
	}
	currentRPMHigher := 800.0

	DetectThrowPhases(pingUpdate, currentRPMHigher, hub)

	if session.MaxRPM != currentRPMHigher {
		t.Errorf("Expected MaxRPM to update to %f, got %f", currentRPMHigher, session.MaxRPM)
	}

	// Test Case 3: Detect Landing
	// Trigger: RPM < 100 AND Z-axis ~ 1.0 (gravity)
	// Must ensure duration > 1.5s to avoid discard

	// Fast forward time for valid throw duration
	session.StartPos.Timestamp = time.Now().Add(-2 * time.Second).UnixMilli()

	pingLand := &pb.Ping{
		DeviceId:  deviceID,
		Timestamp: time.Now().UnixMilli(),
		AccelZ:    1.05, // Close to 1.0
	}
	currentRPMLand := 50.0 // < 100

	DetectThrowPhases(pingLand, currentRPMLand, hub)

	// Session should be removed from activeSessions or marked inactive
	// The code deletes it from the map
	_, existsAfterLand := activeSessions[deviceID]
	if existsAfterLand {
		t.Errorf("Expected session to be removed after landing, but it still exists")
	}

	// Check if broadcast happened
	select {
	case <-hub.broadcast:
		// Good
	default:
		t.Errorf("Expected broadcast message on landing, got none")
	}
}
