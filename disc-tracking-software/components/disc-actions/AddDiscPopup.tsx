// components/disc-actions/AddDiscPopup.tsx
'use client';

// ──────────────────────────────────────────────────────────────
// AddDiscPopup – modal for adding a new tracked disc
// Fields: Disc Name, Disc Type, Connection Number
// Backend integration: POST new disc to server
// ──────────────────────────────────────────────────────────────

type AddDiscPopupProps = {
  trackingNumber: string;          // Connection Number (hardware ID)
  discName: string;                // User-friendly name
  discType: string;                // NEW: Disc type/category
  onChangeTrackingNumber: (value: string) => void;
  onChangeDiscName: (value: string) => void;
  onChangeDiscType: (value: string) => void; // NEW handler
  onAdd: () => void;
  onCancel: () => void;
};

export default function AddDiscPopup({
  trackingNumber,
  discName,
  discType,
  onChangeTrackingNumber,
  onChangeDiscName,
  onChangeDiscType,
  onAdd,
  onCancel,
}: AddDiscPopupProps) {
  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-60" onClick={onCancel} />

      <div className="fixed inset-0 flex items-center justify-center z-70 px-4">
        <div className="bg-[#223066] rounded-xl p-6 w-full max-w-sm border border-[#764d9f]/50 shadow-2xl">
          <h3 className="text-lg font-semibold text-white mb-4">Add New Tracker Disc</h3>

          <div className="space-y-6">
            {/* Disc Name */}
            <div>
              <label className="block text-sm text-white/80 mb-2">
                Disc Name
              </label>
              <input
                type="text"
                value={discName}
                onChange={(e) => onChangeDiscName(e.target.value)}
                placeholder="e.g. Star Destroyer"
                className="w-full px-4 py-3 bg-[#190f2A] border border-[#456fb6]/60 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-[#54c4c3] focus:ring-2 focus:ring-[#54c4c3]/40"
              />
            </div>

            {/* NEW: Disc Type */}
            <div>
              <label className="block text-sm text-white/80 mb-2">
                Disc Type
              </label>
              <input
                type="text"
                value={discType}
                onChange={(e) => onChangeDiscType(e.target.value)}
                placeholder="e.g. Distance Driver, Midrange, Putter"
                className="w-full px-4 py-3 bg-[#190f2A] border border-[#456fb6]/60 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-[#54c4c3] focus:ring-2 focus:ring-[#54c4c3]/40"
              />
            </div>

            {/* Connection Number */}
            <div>
              <label className="block text-sm text-white/80 mb-2">
                Connection Number
              </label>
              <input
                type="text"
                value={trackingNumber}
                onChange={(e) => onChangeTrackingNumber(e.target.value)}
                placeholder="Enter connection number..."
                className="w-full px-4 py-3 bg-[#190f2A] border border-[#456fb6]/60 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-[#54c4c3] focus:ring-2 focus:ring-[#54c4c3]/40"
              />
            </div>

            <p className="text-sm text-white/60">
              Enter the disc details and unique connection number from your tracker device.
            </p>

            <div className="flex gap-4 mt-6">
              <button
                className="flex-1 bg-gray-700 text-white py-3 rounded-lg hover:bg-gray-600 transition"
                onClick={onCancel}
              >
                Cancel
              </button>
              <button
                className="flex-1 bg-[#54c4c3] text-black py-3 rounded-lg hover:bg-[#3daaa9] transition font-medium"
                onClick={() => {
                  // TODO (Backend): Validate and send to server
                  // Example payload for POST /api/discs:
                  // {
                  //   name: discName.trim(),
                  //   type: discType.trim(),
                  //   connectionNumber: trackingNumber.trim()
                  // }
                  // On success:
                  // - Return created disc object with id
                  // - Parent adds to disc list (refetch or append)
                  // - Show success message
                  // - Close popup
                  onAdd();
                }}
              >
                Add Disc
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}