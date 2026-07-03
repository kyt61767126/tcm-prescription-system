import React, { useState } from 'react';
import { saveCloudUsers, setAppMode, setUserAllowCloud } from '../../utils/api';
import { logger } from '../../utils/logger';
import { User, CloudUser } from '../../types';

interface AccountManagementProps {
  user: User | null;
  cloudUsers: CloudUser[];
  setCloudUsers: (users: CloudUser[]) => void;
  login: (user: User) => void;
  currentMode: 'cloud' | 'offline';
  setCurrentMode: (mode: 'cloud' | 'offline') => void;
}

const AccountManagement: React.FC<AccountManagementProps> = ({
  user,
  cloudUsers,
  setCloudUsers,
  login,
  currentMode,
  setCurrentMode,
}) => {
  const [formData, setFormData] = useState<{
    username: string;
    password: string;
    name: string;
    role: 'admin' | 'user';
  }>({
    username: '',
    password: '',
    name: '',
    role: 'user'
  });

  const handleUserAllowCloudChange = async (username: string, allowCloud: boolean) => {
    if (!user) return;

    const updatedUsers = cloudUsers.map(u =>
      u.username === username ? { ...u, allowCloud } : u
    );
    setCloudUsers(updatedUsers);

    try {
      await saveCloudUsers(user, updatedUsers);
      if (username === user.username) {
        const updatedUser = { ...user, allowCloud };
        login(updatedUser);
        setUserAllowCloud(allowCloud);
        if (!allowCloud && currentMode === 'cloud') {
          setCurrentMode('offline');
          setAppMode('offline');
        }
      }
    } catch (error) {
      logger.error('Failed to save user mode:', error);
    }
  };

  const handleSaveUser = async () => {
    if (!user) return;
    if (!formData.username.trim()) {
      alert('请输入用户名');
      return;
    }
    if (!formData.password.trim()) {
      alert('请输入密码');
      return;
    }

    const updatedUsers = [...cloudUsers, {
      ...formData
    }];

    setCloudUsers(updatedUsers);

    try {
      await saveCloudUsers(user, updatedUsers);
      alert('用户添加成功');
    } catch (error) {
      logger.error('Failed to save user:', error);
      alert('保存失败，请重试');
    }
  };

  const handleEditUser = async (cloudUser: CloudUser) => {
    if (!user) return;

    const newUsername = prompt('请输入新登录账户（英文或拼音）：', cloudUser.username);
    if (newUsername === null) return;

    const trimmedUsername = newUsername.trim();
    if (!trimmedUsername) {
      alert('用户名不能为空');
      return;
    }

    if (trimmedUsername !== cloudUser.username) {
      const exists = cloudUsers.find((u) => u.username === trimmedUsername);
      if (exists) {
        alert('用户名已存在');
        return;
      }
    }

    const newName = prompt('请输入医师姓名（中文）：', cloudUser.name);
    if (newName === null) return;

    const trimmedName = newName.trim();
    if (!trimmedName) {
      alert('名称不能为空');
      return;
    }

    const newPassword = prompt('请输入新密码（留空则不修改）：', '');

    const updatedUsers = cloudUsers.map((u) => {
      if (u.username === cloudUser.username) {
        const updated = { ...u, username: trimmedUsername, name: trimmedName };
        if (newPassword !== null && newPassword.trim() !== '') {
          updated.password = newPassword.trim();
        }
        return updated;
      }
      return u;
    });

    setCloudUsers(updatedUsers);

    try {
      await saveCloudUsers(user, updatedUsers);

      if (cloudUser.username === user.username) {
        const updatedUser = updatedUsers.find((u) => u.username === trimmedUsername);
        if (updatedUser) {
          login({
            username: updatedUser.username,
            name: updatedUser.name,
            role: updatedUser.role || 'user',
            allowCloud: updatedUser.allowCloud || false
          });
        }
      }

      alert('用户信息修改成功！');
    } catch (error) {
      logger.error('Failed to edit user:', error);
      alert('保存失败，请重试');
    }
  };

  const handleDeleteUser = async (username: string) => {
    if (!user) return;
    if (username === 'admin') {
      alert('不能删除管理员账号');
      return;
    }
    if (!confirm(`确定要删除用户 "${username}" 吗？`)) {
      return;
    }

    const updatedUsers = cloudUsers.filter(u => u.username !== username);
    setCloudUsers(updatedUsers);

    try {
      await saveCloudUsers(user, updatedUsers);
      alert('用户删除成功');
    } catch (error) {
      logger.error('Failed to delete user:', error);
      alert('删除失败，请重试');
    }
  };

  const forceSyncUsersToCloud = async () => {
    if (!user) return;
    try {
      await saveCloudUsers(user, cloudUsers);
      alert('用户已同步到云端');
    } catch (error) {
      logger.error('Failed to sync users:', error);
      alert('同步失败，请重试');
    }
  };

  return (
    <div style={{
      background: 'white',
      margin: '10px',
      border: '1px solid #808080',
      borderRadius: '4px',
      overflow: 'hidden'
    }}>
      <div style={{
        background: '#000080',
        color: 'white',
        padding: '8px 15px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '13px',
        fontWeight: 'bold'
      }}>
        <span>账户管理</span>
        <span style={{ fontSize: '24px', cursor: 'default', lineHeight: '1' }}>×</span>
      </div>
      <div style={{ padding: '15px', background: 'white' }}>
        <div style={{ maxHeight: '200px', overflowY: 'auto', marginBottom: '15px', border: '1px solid #ddd', borderRadius: '6px' }}>
          {cloudUsers.map((cloudUser) => (
            <div key={cloudUser.username} style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px',
              borderBottom: '1px solid #eee'
            }}>
              <div>
                <div style={{ fontWeight: 'bold', color: '#333', fontSize: '13px' }}>{cloudUser.name || cloudUser.username}</div>
                <div style={{ fontSize: '11px', color: '#666' }}>{cloudUser.username} · {cloudUser.role === 'admin' ? '管理员' : '普通用户'}</div>
                {cloudUser.username !== 'admin' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '5px' }}>
                    <span style={{ fontSize: '10px', color: '#666' }}>允许云端</span>
                    <button
                      onClick={() => handleUserAllowCloudChange(cloudUser.username, !(cloudUser.allowCloud || false))}
                      style={{
                        width: '40px',
                        height: '20px',
                        borderRadius: '10px',
                        border: 'none',
                        cursor: 'pointer',
                        background: cloudUser.allowCloud ? '#008000' : '#ccc',
                        position: 'relative'
                      }}
                    >
                      <span style={{
                        position: 'absolute',
                        top: '1px',
                        left: cloudUser.allowCloud ? '21px' : '1px',
                        width: '18px',
                        height: '18px',
                        borderRadius: '50%',
                        background: 'white',
                        transition: 'left 0.2s'
                      }}></span>
                    </button>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '5px' }}>
                <button
                  onClick={() => handleEditUser(cloudUser)}
                  style={{
                    padding: '4px 8px',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '11px',
                    background: '#ff9800',
                    color: 'white'
                  }}
                >编辑</button>
                {cloudUser.username !== 'admin' && (
                  <button
                    onClick={() => handleDeleteUser(cloudUser.username)}
                    style={{
                      padding: '4px 8px',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '11px',
                      background: '#ff4444',
                      color: 'white'
                    }}
                  >删除</button>
                )}
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginBottom: '15px' }}>
          <div style={{ fontWeight: 'bold', fontSize: '12px', color: '#333', marginBottom: '5px' }}>添加新用户</div>
          <input
            type="text"
            value={formData.username}
            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
            placeholder="登录账号，建议英文或拼音"
            style={{
              width: '100%',
              padding: '10px',
              border: '2px solid #ddd',
              borderRadius: '6px',
              fontSize: '13px',
              boxSizing: 'border-box',
              marginBottom: '5px'
            }}
          />
          <input
            type="password"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            placeholder="密码"
            style={{
              width: '100%',
              padding: '10px',
              border: '2px solid #ddd',
              borderRadius: '6px',
              fontSize: '13px',
              boxSizing: 'border-box',
              marginBottom: '5px'
            }}
          />
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="医师姓名，如：张医生"
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
          style={{
            padding: '4px 10px',
            background: '#e0e0e0',
            border: '2px solid #808080',
            cursor: 'default',
            fontWeight: 'bold',
            fontSize: '11px'
          }}
        >关闭</button>
        <button
          onClick={forceSyncUsersToCloud}
          style={{
            padding: '4px 10px',
            background: '#e0e0e0',
            border: '2px solid #808080',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: '11px'
          }}
        >同步用户到云端</button>
        <button
          onClick={handleSaveUser}
          style={{
            padding: '4px 10px',
            background: '#008000',
            color: 'white',
            border: '2px solid #006000',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: '11px'
          }}
        >添加用户</button>
      </div>
    </div>
  );
};

export default AccountManagement;
