import React from 'react';

interface ToastProps {
  message: string;
}

const Toast: React.FC<ToastProps> = ({ message }) => {
  if (!message) return null;
  return (
    <div style={{
      position: 'fixed',
      top: '20%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      padding: '12px 24px',
      background: '#333',
      color: 'white',
      fontSize: '14px',
      borderRadius: '6px',
      boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
      zIndex: 10000
    }}>
      {message}
    </div>
  );
};

export default Toast;
