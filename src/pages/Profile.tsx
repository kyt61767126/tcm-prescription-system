import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { usePrescriptionStore } from '../stores/prescriptionStore';
import { useMedicineStore } from '../stores/medicineStore';
import { loadPrescriptions, loadCloudUsers, getAppMode, setAppMode, syncLocalToCloud } from '../utils/api';
import { useAuthRedirect } from '../hooks/useAuthRedirect';
import { CloudUser } from '../types';
import { logger } from '../utils/logger';
import AccountManagement from '../components/Profile/AccountManagement';

const Profile: React.FC = () => {
  const navigate = useNavigate();
  const user = useAuthRedirect();
  const login = useAuthStore((state) => state.login);
  const logout = useAuthStore((state) => state.logout);
  
  const prescriptions = usePrescriptionStore((state) => state.prescriptions);
  const setPrescriptions = usePrescriptionStore((state) => state.setPrescriptions);
  
  const medicines = useMedicineStore((state) => state.medicines);
  const formulas = useMedicineStore((state) => state.formulas);
  
  const [currentMode, setCurrentMode] = useState<'cloud' | 'offline'>(getAppMode());
  const [cloudUsers, setCloudUsers] = useState<CloudUser[]>([]);

  const loadData = useCallback(async () => {
    if (!user) return;

    try {
      const result = await loadPrescriptions(user);
      if (result.success) {
        setPrescriptions(result.data);
      }

      if (user.role === 'admin') {
        const usersResult = await loadCloudUsers();
        if (usersResult.success) {
          setCloudUsers(usersResult.data);
        }
      }
    } catch (error) {
      logger.error('Failed to load data:', error);
    }
  }, [user, setPrescriptions]);

  useEffect(() => {
    if (!user) return;

    loadData();
  }, [user, loadData]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleModeSwitch = () => {
    const allowCloud = user?.allowCloud || false;
    if (!allowCloud) {
      alert('您的账号未开通云端访问权限，请联系管理员开通');
      return;
    }
    const newMode = currentMode === 'cloud' ? 'offline' : 'cloud';
    setCurrentMode(newMode);
    setAppMode(newMode);
  };

  return (
    <div style={{
      minHeight: 'calc(100vh - 60px)',
      paddingBottom: '110px',
      backgroundColor: '#f0f0f0'
    }}>
      <div style={{
        background: '#c0c0c0',
        padding: '15px',
        borderBottom: '2px solid #808080'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <div style={{
            width: '80px',
            height: '80px',
            background: '#e0e0e0',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '2px solid #808080',
            fontSize: '32px'
          }}>👤</div>
          <div>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#333' }}>{user?.name || user?.username || '用户'}</div>
            <div style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>{user?.username}</div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
              <span style={{
                padding: '4px 8px',
                background: '#d0d0d0',
                borderRadius: '4px',
                fontSize: '11px',
                border: '1px solid #808080'
              }}>{user?.role === 'admin' ? '管理员' : '普通用户'}</span>
              <span style={{
                padding: '4px 8px',
                background: '#d0d0d0',
                borderRadius: '4px',
                fontSize: '11px',
                border: '1px solid #808080'
              }}>{currentMode === 'cloud' ? '云端模式' : '离线模式'}</span>
            </div>
          </div>
        </div>
      </div>

      <div style={{
        background: 'white',
        margin: '10px',
        padding: '15px',
        border: '1px solid #808080',
        borderRadius: '4px'
      }}>
        <div style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '15px', color: '#333' }}>数据统计</div>
        <div style={{ display: 'flex', justifyContent: 'space-around' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#333' }}>{prescriptions.length}</div>
            <div style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>处方数量</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#333' }}>{medicines.length}</div>
            <div style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>药品种类</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#333' }}>{formulas.length}</div>
            <div style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>方剂数量</div>
          </div>
        </div>
      </div>

      {user?.role === 'admin' && (
        <AccountManagement
          user={user}
          cloudUsers={cloudUsers}
          setCloudUsers={setCloudUsers}
          login={login}
          currentMode={currentMode}
          setCurrentMode={setCurrentMode}
        />
      )}

      <div style={{
        background: 'white',
        margin: '10px',
        border: '1px solid #808080',
        borderRadius: '4px',
        overflow: 'hidden'
      }}>
        <div style={{ fontWeight: 'bold', fontSize: '13px', padding: '10px 15px', borderBottom: '1px solid #eee', color: '#333' }}>功能菜单</div>
        <div>
          <button
            onClick={() => {}}
            style={{
              width: '100%',
              padding: '12px 15px',
              textAlign: 'left',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: '14px',
              borderBottom: '1px solid #eee',
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#f5f5f5'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
          >
            <span>⚙️</span>
            <span>系统设置</span>
            <span style={{ marginLeft: 'auto', color: '#ccc' }}>→</span>
          </button>
          {(user?.allowCloud || user?.role === 'admin') && (
            <button
              onClick={handleModeSwitch}
              style={{
                width: '100%',
                padding: '12px 15px',
                textAlign: 'left',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontSize: '14px',
                borderBottom: '1px solid #eee',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#f5f5f5'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
            >
              <span>{currentMode === 'cloud' ? '☁️' : '💾'}</span>
              <span>{currentMode === 'cloud' ? '切换到离线模式' : '切换到云端模式'}</span>
              <span style={{ marginLeft: 'auto', color: '#ccc' }}>→</span>
            </button>
          )}
          <button
            onClick={async () => {
              if (!user) return;
              const result = await syncLocalToCloud(user);
              alert(result.success ? `成功同步 ${result.syncedCount} 条处方到云端` : result.error || '同步失败');
            }}
            style={{
              width: '100%',
              padding: '12px 15px',
              textAlign: 'left',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: '14px',
              borderBottom: '1px solid #eee',
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#f5f5f5'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
          >
            <span>📤</span>
            <span>上传本地处方到云端</span>
            <span style={{ marginLeft: 'auto', color: '#ccc' }}>→</span>
          </button>
          <button
            onClick={loadData}
            style={{
              width: '100%',
              padding: '12px 15px',
              textAlign: 'left',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: '14px',
              borderBottom: '1px solid #eee',
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#f5f5f5'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
          >
            <span>🔄</span>
            <span>云端同步</span>
            <span style={{ marginLeft: 'auto', color: '#ccc' }}>→</span>
          </button>
          <button
            onClick={() => {}}
            style={{
              width: '100%',
              padding: '12px 15px',
              textAlign: 'left',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: '14px',
              borderBottom: '1px solid #eee',
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#f5f5f5'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
          >
            <span>🛡️</span>
            <span>隐私安全</span>
            <span style={{ marginLeft: 'auto', color: '#ccc' }}>→</span>
          </button>
          <button
            onClick={() => {}}
            style={{
              width: '100%',
              padding: '12px 15px',
              textAlign: 'left',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: '14px',
              borderBottom: '1px solid #eee',
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#f5f5f5'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
          >
            <span>❓</span>
            <span>帮助中心</span>
            <span style={{ marginLeft: 'auto', color: '#ccc' }}>→</span>
          </button>
          <button
            onClick={() => {}}
            style={{
              width: '100%',
              padding: '12px 15px',
              textAlign: 'left',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: '14px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#f5f5f5'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
          >
            <span>ℹ️</span>
            <span>关于我们</span>
            <span style={{ marginLeft: 'auto', color: '#ccc' }}>→</span>
          </button>
        </div>
      </div>

      <div style={{
        background: 'white',
        margin: '10px',
        border: '1px solid #808080',
        borderRadius: '4px',
        overflow: 'hidden'
      }}>
        <button
          onClick={handleLogout}
          style={{
            width: '100%',
            padding: '15px',
            textAlign: 'left',
            border: 'none',
            background: '#ffeaea',
            cursor: 'pointer',
            fontSize: '14px',
            color: '#8b0000',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}
        >
          <span>🚪</span>
          <span>退出登录</span>
        </button>
      </div>

      <div style={{ textAlign: 'center', padding: '20px', fontSize: '11px', color: '#999' }}>
        <div>中医处方系统 v1.0.0</div>
        <div style={{ marginTop: '5px' }}>云端数据安全可靠</div>
      </div>
    </div>
  );
};

export default Profile;