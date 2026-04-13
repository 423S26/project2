// components/disc-actions/AddDiscPopup.tsx
'use client';

type AddDiscPopupProps = {
  trackingNumber: string;
  discName: string;
  discType: string;
  weight: number;
  color: string;
  onChangeTrackingNumber: (value: string) => void;
  onChangeDiscName: (value: string) => void;
  onChangeDiscType: (value: string) => void;
  onChangeWeight: (value: number) => void;
  onChangeColor: (value: string) => void;
  onAdd: () => void;
  onCancel: () => void;
  isLoading?: boolean;
};

export default function AddDiscPopup({
  trackingNumber,
  discName,
  discType,
  weight,
  color,
  onChangeTrackingNumber,
  onChangeDiscName,
  onChangeDiscType,
  onChangeWeight,
  onChangeColor,
  onAdd,
  onCancel,
  isLoading = false,
}: AddDiscPopupProps) {
  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-60" onClick={onCancel} />

      <div className="fixed inset-0 flex items-center justify-center z-70 px-4">
        <div className="bg-[#223066] rounded-xl p-6 w-full max-w-sm border border-[#764d9f]/50 shadow-2xl">
          <h3 className="text-lg font-semibold text-white mb-4">Add New Tracker Disc</h3>

          <div className="space-y-4">
            {/* Tracking Number (MAC Address) */}
            <div>
              <label className="block text-sm text-white/80 mb-2">
                Tracking Number (MAC Address)
              </label>
              <input
                type="text"
                value={trackingNumber}
                onChange={(e) => onChangeTrackingNumber(e.target.value)}
                placeholder="e.g. C000123456789ABC"
                className="w-full px-4 py-3 bg-[#190f2A] border border-[#456fb6]/60 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-[#54c4c3] focus:ring-2 focus:ring-[#54c4c3]/40"
              />
            </div>

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

            {/* Disc Type */}
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

            {/* Weight */}
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-sm text-white/80 mb-2">
                  Weight (g)
                </label>
                <input
                  type="number"
                  min="100"
                  max="250"
                  value={weight}
                  onChange={(e) => onChangeWeight(parseInt(e.target.value) || 175)}
                  placeholder="175"
                  className="w-full px-4 py-3 bg-[#190f2A] border border-[#456fb6]/60 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-[#54c4c3] focus:ring-2 focus:ring-[#54c4c3]/40"
                />
              </div>

              {/* Color */}
              <div className="flex-1">
                <label className="block text-sm text-white/80 mb-2">
                  Color
                </label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => onChangeColor(e.target.value)}
                    className="w-12 h-11 rounded-lg cursor-pointer border border-[#456fb6]/60"
                  />
                  <input
                    type="text"
                    value={color}
                    onChange={(e) => onChangeColor(e.target.value)}
                    placeholder="#000000"
                    className="flex-1 px-4 py-3 bg-[#190f2A] border border-[#456fb6]/60 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-[#54c4c3] focus:ring-2 focus:ring-[#54c4c3]/40"
                  />
                </div>
              </div>
            </div>

            <p className="text-sm text-white/60">
              Enter the disc details to add to your collection.
            </p>

            <div className="flex gap-4 mt-6">
              <button
                className="flex-1 bg-gray-700 text-white py-3 rounded-lg hover:bg-gray-600 transition disabled:opacity-50"
                onClick={onCancel}
                disabled={isLoading}
              >
                Cancel
              </button>
              <button
                className="flex-1 bg-[#54c4c3] text-black py-3 rounded-lg hover:bg-[#3daaa9] transition font-medium disabled:opacity-50"
                onClick={onAdd}
                disabled={isLoading}
              >
                {isLoading ? 'Adding...' : 'Add Disc'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}