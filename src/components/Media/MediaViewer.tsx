import React, { useState, useEffect, useCallback } from 'react';

interface MediaFile {
  name: string;
  path: string;
  size?: number;
  type?: string;
}

interface MediaViewerProps {
  patientName: string;
  prescriptionNo: string;
  onClose: () => void;
}

const MediaViewer: React.FC<MediaViewerProps> = ({ patientName, prescriptionNo, onClose }) => {
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mediaData, setMediaData] = useState<Record<string, string>>({});
  const [selectedFile, setSelectedFile] = useState<MediaFile | null>(null);
  const [deleting, setDeleting] = useState(false);

  const electronAPI = (window as any).electronAPI;

  const isVideo = (name: string) => name.toLowerCase().endsWith('.webm') || name.toLowerCase().endsWith('.mp4');
  const isImage = (name: string) => name.toLowerCase().endsWith('.png') || name.toLowerCase().endsWith('.jpg') || name.toLowerCase().endsWith('.jpeg');
  
  const shouldUseSystemPlayer = (file: MediaFile) => {
    return isVideo(file.name);
  };
  
  const handleVideoClick = (file: MediaFile, data: string | undefined) => {
    if (shouldUseSystemPlayer(file)) {
      electronAPI?.openFile(file.path);
    } else if (data) {
      setSelectedFile(file);
    } else {
      electronAPI?.openFile(file.path);
    }
  };

  const loadMediaFiles = useCallback(async () => {
    if (!electronAPI || !electronAPI.findMediaFiles) {
      setError('处方文件查看功能不可用（需在APP或桌面端使用）');
      setLoading(false);
      return;
    }

    try {
      const result = await electronAPI.findMediaFiles(patientName, prescriptionNo);
      if (result.success && result.files) {
        const sorted = [...result.files].sort((a: MediaFile, b: MediaFile) => {
          const order = (name: string) => {
            if (name.includes('photo') && name.includes('tongue_front')) return 0;
            if (name.includes('photo') && name.includes('tongue_under')) return 1;
            if (name.includes('photo') || name.includes('prescription')) return 2;
            if (name.includes('video')) return 3;
            return 4;
          };
          return order(a.name) - order(b.name) || a.name.localeCompare(b.name);
        });
        setFiles(sorted);
      } else {
        setFiles([]);
      }
    } catch (e) {
      setError('加载处方文件失败：' + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [electronAPI, patientName, prescriptionNo]);

  useEffect(() => {
    loadMediaFiles();
  }, [loadMediaFiles]);

  useEffect(() => {
    if (!files.length || !electronAPI?.readFileAsBase64) return;

    let cancelled = false;
    const loaded = new Set<string>();

    const loadAllMedia = async () => {
      for (const file of files) {
        if (cancelled || loaded.has(file.path)) continue;
        loaded.add(file.path);
        
        if (shouldUseSystemPlayer(file)) {
          continue;
        }
        
        try {
          const result = await electronAPI.readFileAsBase64(file.path);
          if (!cancelled && result.success) {
            const dataUrl = result.data || result.base64;
            if (dataUrl) {
              setMediaData(prev => ({ ...prev, [file.path]: dataUrl }));
            }
          }
        } catch (e) {
          console.error('加载处方失败:', e);
        }
      }
    };

    loadAllMedia();

    return () => { cancelled = true; };
  }, [files, electronAPI, shouldUseSystemPlayer]);

  const getFileLabel = (name: string) => {
    if (name.includes('tongue_front')) return '舌面图像';
    if (name.includes('tongue_under')) return '舌下络脉';
    if (name.includes('prescription')) return '处方';
    if (name.includes('photo')) return '处方';
    if (name.includes('video')) return '视频';
    return '处方';
  };

  const formatFileSize = (bytes: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  };

  const deleteFile = async (file: MediaFile) => {
    if (!electronAPI?.deleteFile) {
      alert('删除功能不可用');
      return;
    }
    if (!confirm(`确定要删除文件 "${file.name}" 吗？`)) return;

    try {
      const result = await electronAPI.deleteFile(file.path);
      if (result.success) {
        setFiles(prev => prev.filter(f => f.path !== file.path));
        setMediaData(prev => {
          const newData = { ...prev };
          delete newData[file.path];
          return newData;
        });
      } else {
        alert('删除失败：' + (result.error || '未知错误'));
      }
    } catch (e) {
      alert('删除失败：' + (e as Error).message);
    }
  };

  const deleteAllFiles = async () => {
    if (files.length === 0) return;
    if (!confirm(`确定要删除全部 ${files.length} 个处方文件吗？此操作不可撤销！`)) return;

    setDeleting(true);
    try {
      for (const file of files) {
        if (electronAPI?.deleteFile) {
          await electronAPI.deleteFile(file.path);
        }
      }
      setFiles([]);
      setMediaData({});
    } catch (e) {
      alert('部分文件删除失败：' + (e as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const cols = files.length <= 1 ? 1 : files.length <= 3 ? 2 : 2;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 3000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: '8px',
          width: '95%',
          maxWidth: '700px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            background: '#000080',
            color: 'white',
            padding: '8px 15px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: '14px' }}>📷 处方文件 - {patientName}</span>
          <span
            onClick={onClose}
            style={{ fontSize: '24px', cursor: 'pointer', lineHeight: '1', padding: '0 8px' }}
          >
            ×
          </span>
        </div>

        <div
          style={{
            flex: 1,
            overflow: 'hidden',
            padding: '10px',
            background: '#f5f5f5',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  border: '4px solid #008000',
                  borderTopColor: 'transparent',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                  margin: '0 auto 16px',
                }}
              />
              正在加载处方文件...
            </div>
          ) : error ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#dc3545', fontSize: '14px' }}>
              {error}
            </div>
          ) : files.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#999', fontSize: '14px' }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>📁</div>
              该处方暂无处方文件
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${cols}, 1fr)`,
                gap: '8px',
                flex: 1,
                minHeight: 0,
              }}
            >
              {files.map((file, index) => {
                const data = mediaData[file.path];
                return (
                  <div
                    key={index}
                    style={{
                      background: 'white',
                      borderRadius: '6px',
                      overflow: 'hidden',
                      display: 'flex',
                      flexDirection: 'column',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                      minHeight: 0,
                    }}
                  >
                    <div
                      style={{
                        fontSize: '11px',
                        fontWeight: 'bold',
                        padding: '3px 8px',
                        background: '#f0f0f0',
                        color: '#333',
                        flexShrink: 0,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span>{getFileLabel(file.name)}</span>
                      <span
                        onClick={() => deleteFile(file)}
                        style={{
                          fontSize: '14px',
                          cursor: 'pointer',
                          color: '#dc3545',
                          padding: '0 4px',
                        }}
                        title="删除此文件"
                      >
                        ×
                      </span>
                    </div>
                    <div
                      style={{
                        flex: 1,
                        background: '#000',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minHeight: 0,
                        overflow: 'hidden',
                        cursor: 'pointer',
                      }}
                      onClick={() => {
                        if (isVideo(file.name)) {
                          handleVideoClick(file, data);
                        } else {
                          setSelectedFile(file);
                        }
                      }}
                    >
                      {shouldUseSystemPlayer(file) ? (
                        <div style={{ color: '#fff', fontSize: '14px', textAlign: 'center' }}>
                          <div style={{ fontSize: '24px', marginBottom: '8px' }}>▶</div>
                          <div>点击用系统播放器打开</div>
                          <div style={{ fontSize: '12px', color: '#aaa', marginTop: '4px' }}>
                            {file.size ? formatFileSize(file.size) : ''}
                          </div>
                        </div>
                      ) : data ? (
                        isImage(file.name) ? (
                          <img
                            src={data}
                            alt={file.name}
                            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                          />
                        ) : isVideo(file.name) ? (
                          <video
                            src={data}
                            controls
                            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                            onError={(e: any) => {
                              console.error('视频加载失败:', e);
                              electronAPI?.openFile(file.path);
                            }}
                          />
                        ) : null
                      ) : (
                        <div style={{ color: '#fff', fontSize: '12px' }}>加载中...</div>
                      )}
                      <div
                        style={{
                          position: 'absolute',
                          bottom: '4px',
                          right: '4px',
                          background: 'rgba(0,0,0,0.6)',
                          color: '#fff',
                          fontSize: '10px',
                          padding: '2px 6px',
                          borderRadius: '3px',
                        }}
                      >
                        {file.size ? formatFileSize(file.size) : ''}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div
          style={{
            padding: '8px 15px',
            background: '#e0e0e0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTop: '1px solid #808080',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: '#666' }}>
              {files.length > 0 ? `共 ${files.length} 个文件` : ''}
            </span>
            {files.length > 0 && (
              <button
                onClick={deleteAllFiles}
                disabled={deleting}
                style={{
                  padding: '2px 10px',
                  background: '#dc3545',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '11px',
                  fontWeight: 'bold',
                }}
              >
                {deleting ? '删除中...' : '清除全部'}
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              padding: '4px 16px',
              background: '#e0e0e0',
              border: '2px solid #808080',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '11px',
            }}
          >
            关闭
          </button>
        </div>
      </div>

      {selectedFile && mediaData[selectedFile.path] && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'rgba(0,0,0,0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 3100,
          }}
          onClick={() => setSelectedFile(null)}
        >
          <div
            style={{
              position: 'absolute',
              top: '15px',
              right: '15px',
              color: '#fff',
              fontSize: '32px',
              cursor: 'pointer',
              zIndex: 3101,
            }}
          >
            ×
          </div>
          {isImage(selectedFile.name) ? (
            <img
              src={mediaData[selectedFile.path]}
              alt={selectedFile.name}
              style={{ maxWidth: '95%', maxHeight: '95%', objectFit: 'contain' }}
            />
          ) : isVideo(selectedFile.name) ? (
            <video
              src={mediaData[selectedFile.path]}
              controls
              autoPlay
              style={{ maxWidth: '95%', maxHeight: '95%', objectFit: 'contain' }}
              onError={(e: any) => {
                console.error('全屏视频加载失败:', e);
                electronAPI?.openFile(selectedFile.path);
                setSelectedFile(null);
              }}
            />
          ) : null}
        </div>
      )}
    </div>
  );
};

export default MediaViewer;