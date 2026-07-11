import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { validateLogin, setAppMode, setUserAllowCloud } from '../utils/api';
import { logger } from '../utils/logger';

const Login: React.FC = () => {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const login = useAuthStore((state) => state.login);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user) {
      navigate('/');
      return;
    }
    
    const savedUser = localStorage.getItem('tcm-auth');
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        if (parsed.state?.user) {
          setUsername(parsed.state.user.username);
          setRememberMe(true);
        }
      } catch (e) {
        logger.error('Failed to parse saved user:', e);
      }
    }
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim()) {
      setError('请输入用户名');
      return;
    }

    if (!password.trim()) {
      setError('请输入密码');
      return;
    }

    setLoading(true);
    try {
      const result = await validateLogin(username.trim(), password.trim());
      if (result.success && result.user) {
        const allowCloud = result.user.allowCloud || false;
        setUserAllowCloud(allowCloud);
        if (allowCloud) {
          setAppMode('cloud');
        } else {
          setAppMode('offline');
        }
        login(result.user);
        navigate('/');
      } else {
        setError(result.error || '登录失败，请检查网络连接');
      }
    } catch (e) {
      logger.error('Login failed:', e);
      setError('登录失败，请检查网络连接');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      background: 'linear-gradient(180deg, #e0e0e0 0%, #c8e1f5 100%)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 9999
    }}>
      <div style={{
        width: '90%',
        maxWidth: '340px',
        height: 'auto',
        minHeight: '400px',
        background: 'linear-gradient(180deg, #e0f4ff 0%, #c8e1f5 100%)',
        borderRadius: '8px',
        boxShadow: '0 6px 20px rgba(0, 102, 204, 0.3)',
        overflow: 'hidden',
        position: 'relative',
        border: '2px solid #4a90d9'
      }}>
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: `url('data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 247 300"%3E%3Cdefs%3E%3Cpattern id="circles" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse"%3E%3Ccircle cx="10" cy="10" r="1.5" fill="rgba(74, 144, 217, 0.12)"/%3E%3C/pattern%3E%3C/defs%3E%3Crect fill="url(%23circles)" width="247" height="300"/%3E%3C/svg%3E')`,
          backgroundSize: 'cover'
        }}></div>

        <div style={{
          position: 'relative',
          zIndex: 1,
          padding: '22px 20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '5px',
          background: 'linear-gradient(180deg, #4a90d9 0%, #357abd 100%)',
          borderBottom: '1.5px solid #2962a3'
        }}>
          <div style={{
            fontSize: '20px',
            fontWeight: 'bold',
            color: 'white',
            textShadow: '1px 1px 3px rgba(0,0,0,0.4)',
            letterSpacing: '2px'
          }}>本能中医处方系统</div>
          <div style={{
            fontSize: '13px',
            fontWeight: 'bold',
            color: 'white',
            textShadow: '1px 1px 2px rgba(0,0,0,0.4)'
          }}>【云版】</div>
        </div>

        <div style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          padding: '25px 15px',
          minHeight: 'calc(100% - 80px)'
        }}>
          <div style={{
            background: 'rgba(255,255,255,0.95)',
            borderRadius: '12px',
            padding: '30px 20px',
            width: '100%',
            maxWidth: '360px',
            boxShadow: '0 3px 10px rgba(74, 144, 217, 0.3)',
            border: '1.5px solid #7ab8f5'
          }}>
            <div style={{
              textAlign: 'center',
              padding: '8px 10px',
              background: 'linear-gradient(180deg, #fff5f5 0%, #ffeaea 100%)',
              border: '1px solid #ffcccc',
              borderRadius: '4px',
              marginBottom: '13px'
            }}>
              <div style={{
                fontSize: '11px',
                fontWeight: 'bold',
                color: '#8b0000',
                marginBottom: '2px'
              }}>{clinicName}</div>
            </div>

            <form onSubmit={handleSubmit}>
              <div style={{
                marginBottom: '18px',
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: '10px'
              }}>
                <label style={{
                  width: '60px',
                  textAlign: 'right',
                  marginBottom: 0,
                  fontSize: '16px',
                  fontWeight: 'bold',
                  color: '#333',
                  flexShrink: 0
                }}>用户:</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="请输入用户名"
                  autoComplete="username"
                  style={{
                    width: '100%',
                    height: '48px',
                    fontSize: '16px',
                    padding: '10px 14px',
                    border: '2px solid #4a90d9',
                    borderRadius: '8px',
                    background: 'white',
                    minWidth: '140px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div style={{
                marginBottom: '18px',
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: '10px'
              }}>
                <label style={{
                  width: '60px',
                  textAlign: 'right',
                  marginBottom: 0,
                  fontSize: '16px',
                  fontWeight: 'bold',
                  color: '#333',
                  flexShrink: 0
                }}>密码:</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSubmit(e)}
                  placeholder="请输入密码"
                  style={{
                    width: '100%',
                    height: '48px',
                    fontSize: '16px',
                    padding: '10px 14px',
                    border: '2px solid #4a90d9',
                    borderRadius: '8px',
                    background: 'white'
                  }}
                />
              </div>

              <div style={{
                justifyContent: 'flex-start',
                gap: '4px',
                marginBottom: '8px',
                marginLeft: 0,
                display: 'flex',
                alignItems: 'center'
              }}>
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  style={{
                    flex: 'none',
                    width: '12px',
                    height: '12px',
                    accentColor: '#4a90d9',
                    cursor: 'pointer',
                    margin: 0
                  }}
                />
                <label style={{
                  flex: 'none',
                  width: 'auto',
                  fontSize: '11px',
                  fontWeight: 'normal',
                  color: '#666',
                  cursor: 'pointer'
                }}>记住密码</label>
              </div>

              {error && (
                <div style={{
                  color: '#dc2626',
                  fontSize: '10px',
                  textAlign: 'center',
                  marginTop: '7px',
                  padding: '8px',
                  background: '#fff5f5',
                  borderRadius: '4px',
                  border: '1px solid #fcc'
                }}>
                  {error}
                </div>
              )}

              <div style={{
                gap: '20px',
                marginTop: '25px',
                justifyContent: 'center',
                display: 'flex'
              }}>
                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    width: '100px',
                    height: '52px',
                    fontSize: '18px',
                    padding: 0,
                    background: 'linear-gradient(180deg, #6cb3f0 0%, #4a90d9 100%)',
                    color: '#fff',
                    border: '2px solid #357abd',
                    borderRadius: '8px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    boxShadow: '1.5px 2px 4px rgba(0, 82, 152, 0.35)',
                    transition: 'all 0.2s',
                    opacity: loading ? 0.7 : 1
                  }}
                >
                  {loading ? '登录中...' : '确定'}
                </button>
                <button
                  type="button"
                  onClick={() => {}}
                  style={{
                    width: '100px',
                    height: '52px',
                    fontSize: '18px',
                    padding: 0,
                    background: 'linear-gradient(180deg, #6cb3f0 0%, #4a90d9 100%)',
                    color: '#fff',
                    border: '2px solid #357abd',
                    borderRadius: '8px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    boxShadow: '1.5px 2px 4px rgba(0, 82, 152, 0.35)',
                    transition: 'all 0.2s'
                  }}
                >
                  取消
                </button>
              </div>
            </form>

            <div style={{
              textAlign: 'center',
              marginTop: '20px',
              paddingTop: '15px',
              fontSize: '11px',
              color: '#666'
            }}>
              微信号: yqjzy1688
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;