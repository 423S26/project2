// components/disc-actions/AddDiscPopup.tsx
'use client';

type AddDiscPopupProps = {
  trackingNumber: string;          // Now "Connection Number"
  discName: string;                // NEW: Disc Name
  onChangeTrackingNumber: (value: string) => void;
  onChangeDiscName: (value: string) => void; // NEW handler
  onAdd: () => void;
  onCancel: () => void;
};

export default function AddDiscPopup({
  trackingNumber,
  discName,
  onChangeTrackingNumber,
  onChangeDiscName,
  onAdd,
  onCancel,
}: AddDiscPopupProps) {
  return (
    <>
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-60" onClick={onCancel} />

      <div className="fixed inset-0 flex items-center justify-center z-70 px-4">
        <div className="bg-[#223066] rounded-xl p-6 w-full max-w-sm border border-[#764d9f]/50 shadow-2xl">
          <h3 className="text-lg font-semibold text-white mb-4">Add New Tracker Disc</h3>

          <div className="space-y-6">
            {/* NEW: Disc Name field */}
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

            {/* Connection Number (formerly Tracking Number) */}
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
              Enter the disc name and unique connection number from your tracker device.
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
                onClick={onAdd}
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