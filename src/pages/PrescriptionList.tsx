import React, { useState, useEffect, useCallback } from 'react';
import { useAuthRedirect } from '../hooks/useAuthRedirect';
import { usePrescriptionStore } from '../stores/prescriptionStore';
import { loadPrescriptions, deletePrescription } from '../utils/api';
import { formatDateTime } from '../utils/helpers';
import { useToast } from '../hooks/useToast';
import { Prescription } from '../types';
import { logger } from '../utils/logger';

const PrescriptionList: React.FC = () => {
  const user = useAuthRedirect();
  
  const prescriptions = usePrescriptionStore((state) => state.prescriptions);
  const setPrescriptions = usePrescriptionStore((state) => state.setPrescriptions);
  const deletePrescriptionStore = usePrescriptionStore((state) => state.deletePrescription);
  
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPrescription, setSelectedPrescription] = useState<Prescription | null>(null);
  const { toastMessage, showToast } = useToast();

  const loadPrescriptionList = useCallback(async () => {
    if (!user) return;

    setLoading(true);
    try {
      const result = await loadPrescriptions(user);

      if (result.success) {
        setPrescriptions(result.data);
      }
    } catch (error) {
      logger.error('Failed to load prescriptions:', error);
    } finally {
      setLoading(false);
    }
  }, [user, setPrescriptions]);

  useEffect(() => {
    if (!user) return;

    loadPrescriptionList();
  }, [user, loadPrescriptionList]);

  const handleDelete = async (id: number) => {
    if (!user) return;
    
    if (!window.confirm('确定要删除此处方吗？')) {
      return;
    }
    
    try {
      const result = await deletePrescription(user, id);
      
      if (result.success) {
        deletePrescriptionStore(id);
        showToast('删除成功');
      } else {
        showToast(result.error || '删除失败');
      }
    } catch (e) {
      logger.error('Delete prescription failed:', e);
      showToast('删除失败，请检查网络连接');
    }
  };

  const filteredPrescriptions = prescriptions.filter((p) =>
    (p.patientName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (p.prescriptionNo || '').includes(searchQuery)
  );

  const handleRefresh = () => {
    loadPrescriptionList();
  };

  return (
    <div style={{
      minHeight: 'calc(100vh - 60px)',
      paddingBottom: '110px',
      backgroundColor: '#f0f0f0',
      display: 'flex',
      flexDirection: 'column'
    }}>
      <div style={{
        background: '#000080',
        color: 'white',
        padding: '6px 8px',
        fontWeight: 'bold',
        fontSize: '12px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexShrink: 0
      }}>
        <span>处方历史</span>
        <button
          onClick={handleRefresh}
          style={{
            background: 'none',
            border: 'none',
            color: 'white',
            fontSize: '12px',
            cursor: 'pointer',
            padding: '2px 4px'
          }}
          title="刷新历史处方"
        >🔄</button>
      </div>

      <div style={{
        background: 'white',
        padding: '8px',
        borderBottom: '1px solid #808080',
        flexShrink: 0
      }}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="输入患者姓名搜索..."
          style={{
            width: '100%',
            padding: '8px',
            fontSize: '14px',
            border: '1px solid #808080'
          }}
        />
      </div>

      <div style={{
        flex: 1,
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch'
      }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '20px', color: '#999', fontSize: '11px' }}>
            加载中...
          </div>
        ) : filteredPrescriptions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '20px', color: '#999', fontSize: '11px' }}>
            请输入患者姓名
          </div>
        ) : (
          <div>
            {filteredPrescriptions.map((prescription) => (
              <div
                key={prescription.id}
                onClick={() => setSelectedPrescription(prescription)}
                style={{
                  padding: '12px',
                  borderBottom: '1px solid #d0d0d0',
                  cursor: 'pointer',
                  background: 'white',
                  fontSize: '14px'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#e8f5e9'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
              >
                <div style={{ fontWeight: 'bold', marginBottom: '2px' }}>{prescription.patientName}</div>
                <div style={{ fontSize: '10px', color: '#666' }}>{formatDateTime(prescription.createdAt)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {toastMessage && (
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
          {toastMessage}
        </div>
      )}

      {selectedPrescription && (
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
            width: '95%',
            maxWidth: '900px',
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
              <span>处方详情</span>
              <span
                onClick={() => setSelectedPrescription(null)}
                style={{ fontSize: '24px', cursor: 'pointer', lineHeight: '1' }}
              >×</span>
            </div>

            <div style={{
              flex: 1,
              overflow: 'auto',
              padding: '15px',
              background: 'white'
            }}>
              <div style={{
                background: 'white',
                padding: '16px',
                boxShadow: '3px 3px 10px rgba(0,0,0,0.3)',
                fontFamily: 'SimSun, serif',
                position: 'relative',
                overflow: 'hidden'
              }}>
                <div style={{ textAlign: 'center', fontSize: '15px', fontWeight: 'bold', color: '#2c5530', marginBottom: '4px' }}>惠康堂中医诊所</div>
                <div style={{ textAlign: 'center', fontSize: '18px', fontWeight: 'bold', color: '#8b0000', marginBottom: '8px', letterSpacing: '4px' }}>处 方 笺</div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr',
                  gap: '3px 6px',
                  marginBottom: '6px',
                  borderBottom: '1px solid #000',
                  paddingBottom: '4px',
                  fontSize: '11px'
                }}>
                  <div>姓名: <span>{selectedPrescription.patientName}</span></div>
                  <div>性别: <span>{selectedPrescription.gender}</span></div>
                  <div>年龄: <span>{selectedPrescription.age}</span>岁</div>
                  <div>科别: 中医内科</div>
                  <div>门诊号:</div>
                  <div>日期: <span>{selectedPrescription.visitDate}</span></div>
                </div>

                <div style={{ marginBottom: '16px', lineHeight: '2' }}>
                  <span>病史症状: <span>{selectedPrescription.symptoms || ''}</span></span>
                  <div style={{ borderBottom: '1px solid #000', marginTop: '16px' }}></div>
                </div>

                <div style={{ marginBottom: '0px' }}>
                  <span>诊断: <span>{selectedPrescription.diagnosis || ''}</span></span>
                  <div style={{ borderBottom: '1px solid #000', marginTop: '1px' }}></div>
                </div>

                <div style={{ borderTop: '1px solid #000', borderBottom: '1px solid #000', marginTop: '0px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #000', padding: '3px 0' }}>
                    <span style={{ fontSize: '22px', fontWeight: 'bold', fontStyle: 'italic', color: '#8b0000' }}>RP</span>
                    <span></span>
                    <span style={{ textAlign: 'right', color: '#000080' }}>7剂</span>
                  </div>
                  <div style={{ padding: '3px 0' }}>
                    {selectedPrescription.medicines.map((medicine, index) => (
                      <div key={medicine.id || index} style={{ padding: '1px 0', fontSize: '11px', textAlign: 'center', justifyContent: 'center', alignItems: 'center' }}>
                        {medicine.name} {medicine.dosage}{medicine.unit}
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ marginTop: '3px', paddingTop: '6px', borderTop: '1px solid #000', fontSize: '10px' }}>
                  <div style={{ marginBottom: '4px' }}>用法: 水煎服，日一剂，早晚分服</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '2px' }}>
                    <span>医师: <span>{selectedPrescription.createdBy || user?.name || '________'}</span>（签字）</span>
                    <span>配方: ________ 复核: ________</span>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: '15px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  onClick={() => setSelectedPrescription(null)}
                  style={{
                    padding: '4px 10px',
                    background: '#e0e0e0',
                    border: '2px solid #808080',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '11px'
                  }}
                >关闭</button>
                <button
                  onClick={() => window.print()}
                  style={{
                    padding: '4px 10px',
                    background: '#e0e0e0',
                    border: '2px solid #808080',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '11px'
                  }}
                >打印</button>
                <button
                  onClick={() => handleDelete(selectedPrescription.id)}
                  style={{
                    padding: '4px 10px',
                    background: '#ffdddd',
                    border: '2px solid #808080',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '11px',
                    color: '#8b0000'
                  }}
                >删除</button>
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
                onClick={() => setSelectedPrescription(null)}
                style={{
                  padding: '4px 10px',
                  background: '#e0e0e0',
                  border: '2px solid #808080',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '11px'
                }}
              >关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PrescriptionList;