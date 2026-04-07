// components/disc-actions/types.ts
// ──────────────────────────────────────────────────────────────
// Shared TypeScript types for disc actions components
// Backend developer: Mirror these types in Go structs/models
// Use JSON tags for serialization (e.g. `json:"id"`)
// ──────────────────────────────────────────────────────────────

// Disc – represents a tracked disc in user's bag
// Backend: Store in database (e.g. table: discs)
// Primary key: id (string, UUID recommended)
// Foreign key: userId
export type Disc = {
  id: string;           // Unique identifier (UUID or auto-generated string)
  name: string;         // User-friendly name (e.g. "Star Destroyer")
  type: string;         // Disc type/category (e.g. "Distance Driver", "Midrange", "Putter")
  connectionNumber?: string;  // Hardware identifier (Bluetooth MAC, serial, etc.)
  
  // TODO (Backend): Add more fields as needed
  // manufacturer?: string; - post capstone
  // plasticType?: string; - post capstone
  // weightGrams?: number; - post capstone
  // createdAt?: string;         // ISO timestamp
  // lastSyncedAt?: string;
  // status?: 'active' | 'inactive' | 'lost';
};

// DistanceUnit – user preference for display (feet/meters)
// Backend: Store in user settings/preferences
export type DistanceUnit = 'feet' | 'meters';

// DiscActionsConfig – optional config for DiscActionsDropdown (not currently used)
// Backend: Not persisted – purely frontend config
// Can be removed if not needed, or used for feature flags
export type DiscActionsConfig = {
  showStopwatch?: boolean;
  showThrowAnalysis?: boolean;
  allowSaveThrows?: boolean;
  distanceUnit?: DistanceUnit; // ← User preference (redundant with settings, consider removing)
};

// ──────────────────────────────────────────────────────────────
// Backend Mapping Recommendations (Go structs) - replace with actual implementation using binary instead of json for better performance
// ──────────────────────────────────────────────────────────────

// type Disc struct {
//     ID               string    `json:"id" gorm:"primaryKey"`
//     UserID           string    `json:"-" gorm:"index"`
//     Name             string    `json:"name"`
//     Type             string    `json:"type"`
//     ConnectionNumber string    `json:"connectionNumber,omitempty"`
//     CreatedAt        time.Time `json:"createdAt"`
//     UpdatedAt        time.Time `json:"updatedAt"`
//     // ... additional fields
// }

// type UserSettings struct {
//     UserID           string   `json:"-" gorm:"primaryKey"`
//     DistanceUnit     string   `json:"distanceUnit"`
//     ThrowMode        string   `json:"throwMode"`
//     AutoSaveThrows   bool     `json:"autoSaveThrows"`
//     SelectedMetrics  []string `json:"selectedMetrics" gorm:"type:json"`
// }

// API Payload Examples:
// POST /api/discs
// {
//   "name": "Star Destroyer",
//   "type": "Distance Driver",
//   "connectionNumber": "ABC123"
// }

// GET /api/discs → []Disc

// These types are used across DiscActionsDropdown, AddDiscPopup, RemoveConfirmPopup, etc.
// Ensure API responses match these shapes exactly for type safety.