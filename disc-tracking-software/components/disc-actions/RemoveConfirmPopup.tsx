// components/disc-actions/RemoveConfirmPopup.tsx
'use client';

// ──────────────────────────────────────────────────────────────
// RemoveConfirmPopup – confirmation dialog before removing a tracked disc
// ──────────────────────────────────────────────────────────────

type Props = {
  discName?: string;          // Name of disc being removed (for display)
  onConfirmAction: () => void;  // Called when user confirms removal
  onCancelAction: () => void;   // Called when user cancels
};

export default function RemoveConfirmPopup({ discName, onConfirmAction, onCancelAction }: Props) {
  return (
    <>
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-60" onClick={onCancelAction} />

      <div className="fixed inset-0 flex items-center justify-center z-70 px-4">
        <div className="bg-[#223066] rounded-xl p-6 w-full max-w-sm border border-[#764d9f]/50 shadow-2xl">
          <h3 className="text-lg font-semibold text-white mb-3">Remove Disc?</h3>

          <p className="text-white/80 mb-6">
            Are you sure you want to remove <strong>{discName ?? 'this disc'}</strong> from your tracked discs?
          </p>

          <div className="flex gap-4">
            <button
              className="flex-1 bg-gray-700 text-white py-3 rounded-lg hover:bg-gray-600 transition"
              onClick={onCancelAction}
            >
              Cancel
            </button>

            <button
              className="flex-1 bg-red-600 text-white py-3 rounded-lg hover:bg-red-700 transition"
              onClick={() => {
                onConfirmAction();
              }}
            >
              Remove
            </button>
          </div>
        </div>
      </div>
    </>
  );
}