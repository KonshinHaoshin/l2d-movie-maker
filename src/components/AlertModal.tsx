interface AlertModalProps {
  message: string;
  onClose: () => void;
}

export default function AlertModal({ message, onClose }: AlertModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-icon">⚠️</div>
        <p className="modal-message">{message}</p>
        <button className="btn btn--primary modal-close-btn" onClick={onClose}>
          确定
        </button>
      </div>
    </div>
  );
}
