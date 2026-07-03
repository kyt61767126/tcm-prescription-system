import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePrescriptionStore } from '../../stores/prescriptionStore';
import { actionBarBtnStyle } from './navItems';

interface ActionBarProps {
  position?: 'fixed' | 'static';
}

export function ActionBar({ position = 'fixed' }: ActionBarProps) {
  const navigate = useNavigate();

  const wrapperStyle: CSSProperties = position === 'fixed'
    ? {
        position: 'fixed',
        bottom: '52px',
        left: 0,
        right: 0,
        background: '#e0e0e0',
        borderTop: '2px solid #808080',
        padding: '6px',
        zIndex: 150,
      }
    : {
        background: '#e0e0e0',
        borderTop: '2px solid #808080',
        padding: '6px',
        zIndex: 150,
      };

  return (
    <div style={wrapperStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-around', gap: '5px' }}>
        <button
          onClick={() => usePrescriptionStore.getState().clearForm()}
          style={actionBarBtnStyle('grey')}
        >
          🗑️ 清空
        </button>
        <button
          onClick={() => {}}
          style={actionBarBtnStyle('green')}
        >
          📊 统计分析
        </button>
        <button
          onClick={() => navigate('/profile')}
          style={actionBarBtnStyle('grey')}
        >
          👤 账户管理
        </button>
      </div>
    </div>
  );
}
