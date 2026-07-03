import React, { useState } from 'react';
import { changePassword } from '../../utils/api';
import { User } from '../../types';

interface ChangePasswordModalProps {
  visible: boolean;
  onClose: () => void;
  user: User | null;
}

const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({ visible, onClose, user }) => {
  const [pwdData, setPwdData] = useState({
    oldPwd: '',
    newPwd: '',
    confirmNewPwd: ''
  });

  const handleChangePassword = async () => {
    if (!pwdData.oldPwd.trim()) {
      alert('请输入原密码');
      return;
    }
    if (!pwdData.newPwd.trim()) {
      alert('请输入新密码');
      return;
    }
    if (pwdData.newPwd !== pwdData.confirmNewPwd) {
      alert('两次输入的新密码不一致');
      return;
    }
    if (!user) return;
    const result = await changePassword(user, pwdData.oldPwd, pwdData.newPwd);
    if (result.success) {
      alert('密码修改成功');
      setPwdData({ oldPwd: '', newPwd: '', confirmNewPwd: '' });
      onClose();
    } else {
      alert(result.error || '密码修改失败');
    }
  };

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      background: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 2000,
      display: 'flex',
      padding: '20px'
    }}>
      <div style={{
        background: '#e0e0e0',
        border: '3px solid #808080',
        width: '350px',
        maxHeight: '90vh',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}>
        <div style={{
          background: '#000080',
          color: 'white',
          padding: '8px 15px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span>修改密码</span>
          <span onClick={onClose} style={{ fontSize: '24px', cursor: 'pointer', lineHeight: '1' }}>×</span>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '15px', background: 'white' }}>
          <div style={{ margin: '15px 0', textAlign: 'left' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', fontSize: '12px', color: '#333' }}>原密码</label>
            <input
              type="password"
              value={pwdData.oldPwd}
              onChange={(e) => setPwdData({ ...pwdData, oldPwd: e.target.value })}
              placeholder="请输入原密码"
              style={{
                width: '100%',
                padding: '10px',
                border: '2px solid #ddd',
                borderRadius: '6px',
                fontSize: '13px',
                boxSizing: 'border-box'
              }}
            />
          </div>
          <div style={{ margin: '15px 0', textAlign: 'left' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', fontSize: '12px', color: '#333' }}>新密码</label>
            <input
              type="password"
              value={pwdData.newPwd}
              onChange={(e) => setPwdData({ ...pwdData, newPwd: e.target.value })}
              placeholder="请输入新密码"
              style={{
                width: '100%',
                padding: '10px',
                border: '2px solid #ddd',
                borderRadius: '6px',
                fontSize: '13px',
                boxSizing: 'border-box'
              }}
            />
          </div>
          <div style={{ margin: '15px 0', textAlign: 'left' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', fontSize: '12px', color: '#333' }}>确认新密码</label>
            <input
              type="password"
              value={pwdData.confirmNewPwd}
              onChange={(e) => setPwdData({ ...pwdData, confirmNewPwd: e.target.value })}
              placeholder="请再次输入新密码"
              style={{
                width: '100%',
                padding: '10px',
                border: '2px solid #ddd',
                borderRadius: '6px',
                fontSize: '13px',
                boxSizing: 'border-box'
              }}
            />
          </div>
        </div>
        <div style={{
          padding: '10px 15px',
          background: '#e0e0e0',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '10px',
          borderTop: '2px solid #808080'
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '4px 10px',
              background: '#e0e0e0',
              border: '2px solid #808080',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '11px'
            }}
          >取消</button>
          <button
            onClick={handleChangePassword}
            style={{
              padding: '4px 10px',
              background: '#008000',
              color: 'white',
              border: '2px solid #006000',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '11px'
            }}
          >修改</button>
        </div>
      </div>
    </div>
  );
};

export default ChangePasswordModal;
