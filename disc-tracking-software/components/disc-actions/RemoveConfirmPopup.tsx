// components/RemoveConfirmPopup.tsx
type Props = {
  discName?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function RemoveConfirmPopup({ discName, onConfirm, onCancel }: Props) {
  return (
    <>
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-60" onClick={onCancel} />
      <div className="fixed inset-0 flex items-center justify-center z-70 px-4">
        <div className="bg-[#223066] rounded-xl p-6 w-full max-w-sm border border-[#764d9f]/50 shadow-2xl">
          <h3 className="text-lg font-semibold text-white mb-3">Remove Disc?</h3>
          <p className="text-white/80 mb-6">
            Are you sure you want to remove <strong>{discName}</strong> from your tracked discs?
          </p>
          <div className="flex gap-4">
            <button
              className="flex-1 bg-gray-700 text-white py-3 rounded-lg hover:bg-gray-600 transition"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              className="flex-1 bg-red-600 text-white py-3 rounded-lg hover:bg-red-700 transition"
              onClick={onConfirm}
            >
              Remove
            </button>
          </div>
        </div>
      </div>
    </>
  );
}