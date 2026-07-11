import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthRedirect } from '../hooks/useAuthRedirect';
import { usePrescriptionStore } from '../stores/prescriptionStore';
import { useMedicineStore } from '../stores/medicineStore';
import { savePrescription, loadMedicines, loadFormulas, getAppMode, setAppMode } from '../utils/api';
import { Medicine } from '../types';
import { logger } from '../utils/logger';
import MedicineSearchBar from '../components/Prescription/MedicineSearchBar';
import Toast from '../components/Prescription/Toast';
import { useToast } from '../hooks/useToast';

const Home: React.FC = () => {
  const navigate = useNavigate();
  const user = useAuthRedirect();
  
  const currentForm = usePrescriptionStore((state) => state.currentForm);
  const setFormField = usePrescriptionStore((state) => state.setFormField);
  const createPrescription = usePrescriptionStore((state) => state.createPrescription);
  const clearForm = usePrescriptionStore((state) => state.clearForm);
  const addMedicine = usePrescriptionStore((state) => state.addMedicine);
  const updateMedicine = usePrescriptionStore((state) => state.updateMedicine);
  const removeMedicine = usePrescriptionStore((state) => state.removeMedicine);
  const registrationFee = currentForm.registrationFee || 0;
  const setMedicines = useMedicineStore((state) => state.setMedicines);
  const setFormulas = useMedicineStore((state) => state.setFormulas);
  const medicines = useMedicineStore((state) => state.medicines);
  
  const [activeTab, setActiveTab] = useState<'fill' | 'history'>('fill');
  const [activeHistoryTab, setActiveHistoryTab] = useState<'symptoms' | 'edit'>('symptoms');
  const [loading, setLoading] = useState(false);
  const { toastMessage, showToast } = useToast();
  const [doseCount, setDoseCount] = useState(7);

  useEffect(() => {
    if (!user) return;

    const loadData = async () => {
      try {
        const [medicinesResult, formulasResult] = await Promise.all([
          loadMedicines(),
          loadFormulas(),
        ]);

        if (medicinesResult.success) {
          setMedicines(medicinesResult.data);
        }

        if (formulasResult.success) {
          setFormulas(formulasResult.data);
        }
      } catch (error) {
        logger.error('Failed to load data:', error);
      }
    };

    loadData();
  }, [user, setMedicines, setFormulas]);

  useEffect(() => {
    if (!user) return;
    if (user.registrationFee !== undefined && currentForm.registrationFee === 0) {
      setFormField('registrationFee', user.registrationFee);
    }
  }, [user, currentForm.registrationFee, setFormField]);

  const handleSave = async () => {
    if (!user) return;
    
    const prescription = createPrescription(user.username);
    
    if (!prescription.patientName.trim()) {
      showToast('请输入患者姓名');
      return;
    }

    if (prescription.medicines.length === 0) {
      showToast('请添加至少一种药品');
      return;
    }

    setLoading(true);
    try {
      const result = await savePrescription(user, prescription);

      if (result.success) {
        showToast('处方保存成功！');
        clearForm();
        navigate('/prescriptions');
      } else {
        showToast(result.error || '保存失败');
      }
    } catch (e) {
      logger.error('Save prescription failed:', e);
      showToast('保存失败，请检查网络连接');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickAddMedicine = (medicine: Medicine) => {
    addMedicine({
      name: medicine.name,
      code: medicine.code,
      unit: medicine.unit,
      dosage: medicine.defaultDosage,
      price: medicine.price || 0,
    });
  };

  const handleNameChange = (value: string) => {
    setFormField('patientName', value);
    if (!currentForm.gender && value.trim().length >= 2) {
      const femaleChars = ['花', '梅', '兰', '芳', '英', '珍', '玲', '丽', '娟', '霞', '燕', '红', '玉', '秀', '桂', '凤', '婷', '娜', '敏', '洁', '颖', '雪', '倩', '晓', '丹', '萍', '蓉', '薇', '莹', '佳'];
      const maleChars = ['强', '伟', '军', '明', '华', '建', '国', '文', '志', '永', '立', '海', '金', '正', '德', '宝', '福', '生', '龙', '虎', '杰', '忠', '勇', '刚', '斌', '波', '辉', '鹏', '飞', '宇', '浩', '翔'];
      
      const nameChar = value.charAt(value.length - 1);
      if (femaleChars.includes(nameChar)) {
        setFormField('gender', '女');
      } else if (maleChars.includes(nameChar)) {
        setFormField('gender', '男');
      }
    }
  };

  const totalPrice = useMemo(() => {
    return currentForm.medicines.reduce((sum, m) => sum + m.dosage * m.price, 0);
  }, [currentForm.medicines]);

  const grandTotal = useMemo(() => {
    return totalPrice + registrationFee;
  }, [totalPrice, registrationFee]);

  const currentDate = new Date().toISOString().split('T')[0];

  return (
    <div style={{
      minHeight: 'calc(100vh - 60px)',
      display: 'flex',
      flexDirection: 'column',
      paddingBottom: '110px',
      backgroundColor: '#e0e0e0'
    }}>
      <div style={{
        background: '#e0e0e0',
        display: 'flex',
        borderBottom: '2px solid #808080',
        padding: '2px 4px'
      }}>
        <button
          onClick={() => setActiveTab('fill')}
          style={{
            background: activeTab === 'fill' ? 'white' : '#d0d0d0',
            padding: '6px 8px',
            cursor: 'pointer',
            border: '2px solid #808080',
            marginRight: '2px',
            fontSize: '11px',
            fontWeight: 'bold',
            whiteSpace: 'pre-line',
            lineHeight: '1.2',
            minWidth: '50px',
            textAlign: 'center'
          }}
        >填资\n料</button>
        <button
          onClick={() => setActiveTab('history')}
          style={{
            background: activeTab === 'history' ? 'white' : '#d0d0d0',
            padding: '6px 8px',
            cursor: 'pointer',
            border: '2px solid #808080',
            marginRight: '2px',
            fontSize: '11px',
            fontWeight: 'bold',
            whiteSpace: 'pre-line',
            lineHeight: '1.2',
            minWidth: '50px',
            textAlign: 'center'
          }}
        >调原\n方</button>
        <button
          onClick={clearForm}
          style={{
            padding: '6px 8px',
            fontSize: '11px',
            background: '#d0d0d0',
            border: '2px solid #808080',
            cursor: 'pointer',
            fontWeight: 'bold',
            whiteSpace: 'pre-line',
            lineHeight: '1.2',
            minWidth: '50px',
            textAlign: 'center',
            marginRight: '2px'
          }}
        >重输</button>
        <button
          onClick={() => {}}
          style={{
            padding: '6px 8px',
            fontSize: '11px',
            background: '#d0d0d0',
            border: '2px solid #808080',
            cursor: 'pointer',
            fontWeight: 'bold',
            whiteSpace: 'pre-line',
            lineHeight: '1.2',
            minWidth: '50px',
            textAlign: 'center',
            marginRight: '2px'
          }}
        >存验\n方</button>
        <button
          onClick={() => window.print()}
          style={{
            padding: '6px 8px',
            fontSize: '11px',
            background: '#d0d0d0',
            border: '2px solid #808080',
            cursor: 'pointer',
            fontWeight: 'bold',
            whiteSpace: 'pre-line',
            lineHeight: '1.2',
            minWidth: '60px',
            textAlign: 'center',
            marginRight: '2px'
          }}
        >纵向\n打印</button>
        <button
          onClick={() => window.print()}
          style={{
            padding: '6px 8px',
            fontSize: '11px',
            background: '#d0d0d0',
            border: '2px solid #808080',
            cursor: 'pointer',
            fontWeight: 'bold',
            whiteSpace: 'pre-line',
            lineHeight: '1.2',
            minWidth: '60px',
            textAlign: 'center',
            marginRight: '2px'
          }}
        >横向\n打印</button>
        {(user?.allowCloud || user?.role === 'admin' || user?.role === 'globalAdmin') && (
          <button
            onClick={() => {
              const currentMode = getAppMode();
              const newMode = currentMode === 'cloud' ? 'offline' : 'cloud';
              setAppMode(newMode);
            }}
            style={{
              padding: '6px 8px',
              fontSize: '11px',
              background: getAppMode() === 'cloud' ? '#4a90d9' : '#808080',
              color: 'white',
              border: '2px solid #357abd',
              cursor: 'pointer',
              fontWeight: 'bold',
              whiteSpace: 'pre-line',
              lineHeight: '1.2',
              minWidth: '55px',
              textAlign: 'center',
              marginRight: '2px'
            }}
          >{getAppMode() === 'cloud' ? '☁️\n云端' : '💾\n离线'}</button>
        )}
        <button
          onClick={handleSave}
          disabled={loading}
          style={{
            padding: '6px 12px',
            fontSize: '11px',
            background: '#008000',
            color: 'white',
            border: '2px solid #006000',
            cursor: 'pointer',
            fontWeight: 'bold',
            opacity: loading ? 0.7 : 1,
            minWidth: '45px',
            textAlign: 'center'
          }}
        >保存</button>
      </div>

      <div style={{
        background: 'white',
        padding: '4px 6px',
        borderBottom: '1px solid #808080'
      }}>
        <div style={{
          display: 'flex',
          flexWrap: 'nowrap',
          gap: '3px',
          marginBottom: '4px'
        }}>
          <span style={{
            width: 'auto',
            fontSize: '12px',
            paddingRight: '3px',
            whiteSpace: 'nowrap',
            textAlign: 'right',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end'
          }}>门诊</span>
          <input
            type="text"
            value={currentForm.prescriptionNo || ''}
            readOnly
            style={{
              flex: '0 0 80px',
              padding: '4px 4px',
              border: '1px solid #808080',
              fontSize: '12px',
              minHeight: '32px',
              boxSizing: 'border-box'
            }}
          />
          <span style={{
            width: 'auto',
            fontSize: '12px',
            paddingRight: '3px',
            whiteSpace: 'nowrap',
            textAlign: 'right',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end'
          }}>性别</span>
          <select
            value={currentForm.gender}
            onChange={(e) => setFormField('gender', e.target.value)}
            style={{
              flex: '0 0 45px',
              padding: '4px 4px',
              border: '1px solid #808080',
              fontSize: '12px',
              minHeight: '32px',
              boxSizing: 'border-box'
            }}
          >
            <option value="男">男</option>
            <option value="女">女</option>
          </select>
          <span style={{
            width: 'auto',
            fontSize: '12px',
            paddingRight: '3px',
            whiteSpace: 'nowrap',
            textAlign: 'right',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end'
          }}>日期</span>
          <input
            type="text"
            value={currentForm.visitDate || currentDate}
            onChange={(e) => setFormField('visitDate', e.target.value)}
            style={{
              flex: '0 0 110px',
              padding: '4px 4px',
              border: '1px solid #808080',
              fontSize: '12px',
              minHeight: '32px',
              boxSizing: 'border-box'
            }}
          />
        </div>

        <div style={{
          display: 'flex',
          flexWrap: 'nowrap',
          gap: '3px',
          marginBottom: '4px'
        }}>
          <span style={{
            width: 'auto',
            fontSize: '12px',
            paddingRight: '3px',
            whiteSpace: 'nowrap',
            textAlign: 'right',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end'
          }}>姓名</span>
          <input
            type="text"
            value={currentForm.patientName}
            onChange={(e) => handleNameChange(e.target.value)}
            style={{
              flex: '0 0 80px',
              padding: '4px 4px',
              border: '1px solid #808080',
              fontSize: '12px',
              minHeight: '32px',
              boxSizing: 'border-box'
            }}
          />
          <span style={{
            width: 'auto',
            fontSize: '12px',
            paddingRight: '3px',
            whiteSpace: 'nowrap',
            textAlign: 'right',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end'
          }}>年龄</span>
          <input
            type="text"
            value={currentForm.age}
            onChange={(e) => setFormField('age', e.target.value)}
            style={{
              flex: '0 0 45px',
              padding: '4px 4px',
              border: '1px solid #808080',
              fontSize: '12px',
              minHeight: '32px',
              boxSizing: 'border-box'
            }}
          />
          <span style={{
            width: 'auto',
            fontSize: '12px',
            paddingRight: '3px',
            whiteSpace: 'nowrap',
            textAlign: 'right',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end'
          }}>电话</span>
          <input
            type="text"
            value={currentForm.phone}
            onChange={(e) => setFormField('phone', e.target.value)}
            style={{
              flex: '0 0 110px',
              padding: '4px 4px',
              border: '1px solid #808080',
              fontSize: '12px',
              minHeight: '32px',
              boxSizing: 'border-box'
            }}
          />
        </div>

        <div style={{
          display: 'flex',
          flexWrap: 'nowrap',
          gap: '3px'
        }}>
          <span style={{
            width: 'auto',
            fontSize: '12px',
            paddingRight: '3px',
            whiteSpace: 'nowrap',
            textAlign: 'right',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end'
          }}>统计</span>
          <input
            type="text"
            value={currentForm.clinicNo || ''}
            onChange={(e) => setFormField('clinicNo', e.target.value)}
            style={{
              flex: '0 0 80px',
              padding: '4px 4px',
              border: '1px solid #808080',
              fontSize: '12px',
              minHeight: '32px',
              boxSizing: 'border-box'
            }}
          />
          <span style={{
            width: 'auto',
            fontSize: '12px',
            paddingRight: '3px',
            whiteSpace: 'nowrap',
            textAlign: 'right',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end'
          }}>住址</span>
          <input
            type="text"
            value={currentForm.address || ''}
            onChange={(e) => setFormField('address', e.target.value)}
            style={{
              flex: 1,
              padding: '4px 4px',
              border: '1px solid #808080',
              fontSize: '12px',
              minHeight: '32px',
              boxSizing: 'border-box',
              minWidth: '60px'
            }}
          />
        </div>
      </div>

      <div style={{
        background: 'white',
        padding: '4px 6px',
        borderBottom: '1px solid #808080'
      }}>
        <div style={{ display: 'flex', marginBottom: '2px' }}>
          <div
            onClick={() => setActiveHistoryTab('symptoms')}
            style={{
              background: activeHistoryTab === 'symptoms' ? 'white' : '#d0d0d0',
              padding: '2px 10px',
              cursor: 'pointer',
              border: '1px solid #808080',
              borderBottom: 'none',
              marginRight: '2px',
              fontSize: '10px'
            }}
          >病史症状</div>
          <div
            onClick={() => setActiveHistoryTab('edit')}
            style={{
              background: activeHistoryTab === 'edit' ? 'white' : '#d0d0d0',
              padding: '2px 10px',
              cursor: 'pointer',
              border: '1px solid #808080',
              borderBottom: 'none',
              marginRight: '2px',
              fontSize: '10px'
            }}
          >修改病史</div>
        </div>
        <textarea
          value={currentForm.symptoms}
          onChange={(e) => setFormField('symptoms', e.target.value)}
          placeholder="请输入病史症状..."
          style={{
            width: '100%',
            height: '50px',
            border: '1px solid #808080',
            padding: '2px',
            resize: 'none',
            fontSize: '14px',
            minHeight: '32px',
            boxSizing: 'border-box'
          }}
        />
      </div>

      <div style={{
        background: 'white',
        padding: '2px 4px',
        borderBottom: '1px solid #808080'
      }}>
        <div style={{
          display: 'flex',
          flexWrap: 'nowrap',
          gap: '3px',
          alignItems: 'center'
        }}>
          <span style={{
            width: 'auto',
            fontSize: '12px',
            paddingRight: '3px',
            whiteSpace: 'nowrap',
            textAlign: 'right',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end'
          }}>诊断</span>
          <input
            type="text"
            value={currentForm.diagnosis}
            onChange={(e) => setFormField('diagnosis', e.target.value)}
            style={{
              flex: 1,
              padding: '4px 4px',
              border: '1px solid #808080',
              fontSize: '12px',
              minHeight: '32px',
              boxSizing: 'border-box',
              minWidth: '60px'
            }}
          />
          <span style={{
            width: 'auto',
            fontSize: '12px',
            paddingRight: '3px',
            whiteSpace: 'nowrap',
            textAlign: 'right',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end'
          }}>剂数</span>
          <input
            type="number"
            value={doseCount}
            onChange={(e) => setDoseCount(parseInt(e.target.value) || 7)}
            style={{
              width: '50px',
              padding: '3px',
              fontSize: '14px',
              textAlign: 'center',
              border: '1px solid #808080'
            }}
          />
          <span style={{ fontSize: '13px', marginRight: '8px' }}>剂</span>
          <span style={{
            width: 'auto',
            fontSize: '12px',
            paddingRight: '3px',
            whiteSpace: 'nowrap',
            textAlign: 'right',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end'
          }}>医师</span>
          <input
            type="text"
            value={user?.name || user?.username || ''}
            readOnly
            style={{
              width: '55px',
              minWidth: '55px',
              padding: '4px 4px',
              border: '1px solid #808080',
              fontSize: '12px',
              minHeight: '32px',
              boxSizing: 'border-box',
              background: '#f5f5f5',
              color: '#666',
              cursor: 'not-allowed'
            }}
          />
        </div>
      </div>

      <div style={{
        background: 'white',
        padding: '3px 6px',
        borderBottom: '1px solid #808080'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'flex-start',
          alignItems: 'center',
          gap: '8px',
          padding: '3px 5px',
          overflowX: 'auto'
        }}>
          <span style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>每剂:<span style={{ color: 'red', fontWeight: 'bold' }}>{totalPrice.toFixed(2)}</span>元</span>
          <span style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>药费:<span style={{ color: 'red', fontWeight: 'bold' }}>{(totalPrice * doseCount).toFixed(2)}</span>元</span>
          <span style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>诊疗<input
            type="number"
            value={registrationFee}
            onChange={(e) => setFormField('registrationFee', parseFloat(e.target.value) || 0)}
            style={{ width: '45px', padding: '2px', fontSize: '12px', border: '1px solid #808080' }}
          />元</span>
          <span style={{ fontSize: '12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>总计:<span style={{ color: 'red', fontWeight: 'bold' }}>{grandTotal.toFixed(2)}</span>元</span>
        </div>
      </div>

      <div style={{
        flex: 1,
        background: 'white',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        minHeight: '300px'
      }}>
        <div style={{
          background: '#d0d0d0',
          padding: '3px 8px',
          fontSize: '10px',
          borderBottom: '1px solid #808080'
        }}>
          提示: 在简码栏输入简码，在药名栏输入药名
        </div>

        <div style={{
          flex: 1,
          overflow: 'auto',
          overflowX: 'auto',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          maxHeight: '500px'
        }}>
          {currentForm.medicines.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px', color: '#999', fontSize: '11px' }}>
              请在下方输入简码或药名添加药品
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', minWidth: '100%' }}>
              <thead>
                <tr style={{ background: '#e0e0e0' }}>
                  <th style={{ width: '25px', border: '1px solid #808080', padding: '3px', fontWeight: 'normal', fontSize: '10px', textAlign: 'center' }}>#</th>
                  <th style={{ width: '45px', border: '1px solid #808080', padding: '3px', fontWeight: 'normal', fontSize: '10px', textAlign: 'center' }}>简码</th>
                  <th style={{ width: '90px', border: '1px solid #808080', padding: '3px', fontWeight: 'normal', fontSize: '10px', textAlign: 'left' }}>药物</th>
                  <th style={{ width: '40px', border: '1px solid #808080', padding: '3px', fontWeight: 'normal', fontSize: '10px', textAlign: 'center' }}>数量</th>
                  <th style={{ width: '30px', border: '1px solid #808080', padding: '3px', fontWeight: 'normal', fontSize: '10px', textAlign: 'center' }}>单位</th>
                  <th style={{ width: '40px', border: '1px solid #808080', padding: '3px', fontWeight: 'normal', fontSize: '10px', textAlign: 'right' }}>单价</th>
                  <th style={{ width: '45px', border: '1px solid #808080', padding: '3px', fontWeight: 'normal', fontSize: '10px', textAlign: 'right' }}>合计</th>
                  <th style={{ width: '30px', border: '1px solid #808080', padding: '3px', fontWeight: 'normal', fontSize: '10px', textAlign: 'center' }}>删</th>
                </tr>
              </thead>
              <tbody>
                {currentForm.medicines.map((medicine, index) => (
                  <tr key={medicine.id || index}>
                    <td style={{ border: '1px solid #d0d0d0', padding: '1px', textAlign: 'center', fontSize: '11px', color: '#666' }}>{index + 1}</td>
                    <td style={{ border: '1px solid #d0d0d0', padding: '1px', textAlign: 'center', fontSize: '11px', color: '#666' }}>{medicine.code}</td>
                    <td style={{ border: '1px solid #d0d0d0', padding: '1px', textAlign: 'left', fontSize: '11px' }}>{medicine.name}</td>
                    <td style={{ border: '1px solid #d0d0d0', padding: '1px', textAlign: 'center' }}>
                      <input
                        type="number"
                        value={medicine.dosage}
                        onChange={(e) => updateMedicine(index, { dosage: parseInt(e.target.value) || 1 })}
                        style={{ width: '100%', border: 'none', padding: '2px', textAlign: 'center', fontSize: '11px', minHeight: '16px' }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td style={{ border: '1px solid #d0d0d0', padding: '1px', textAlign: 'center', fontSize: '11px', color: '#666' }}>{medicine.unit}</td>
                    <td style={{ border: '1px solid #d0d0d0', padding: '1px', textAlign: 'right', fontSize: '11px', color: '#666' }}>{medicine.price.toFixed(2)}</td>
                    <td style={{ border: '1px solid #d0d0d0', padding: '1px', textAlign: 'right', fontSize: '11px', fontWeight: 'bold', color: '#8b0000' }}>
                      {(medicine.dosage * medicine.price).toFixed(2)}
                    </td>
                    <td style={{ border: '1px solid #d0d0d0', padding: '1px', textAlign: 'center' }}>
                      <button
                        onClick={() => removeMedicine(index)}
                        style={{ padding: '2px', color: '#8b0000', background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px' }}
                      >✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{
          background: '#e0e0e0',
          padding: '3px 8px',
          fontSize: '10px',
          borderTop: '1px solid #808080'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>已添加 {currentForm.medicines.length} 种药品</span>
            <span>总计: <span style={{ color: '#8b0000', fontWeight: 'bold' }}>{totalPrice.toFixed(2)}</span> 元</span>
          </div>
        </div>
      </div>

      <div style={{
        background: 'white',
        padding: '6px',
        borderTop: '1px solid #808080'
      }}>
        <MedicineSearchBar medicines={medicines} onQuickAdd={handleQuickAddMedicine} />
      </div>

      <Toast message={toastMessage} />
    </div>
  );
};

export default Home;