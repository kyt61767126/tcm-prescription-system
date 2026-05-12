export const runtime = "edge";
'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { getMedicines, getPrescriptions, getFormulas, addPrescription, exportAllData, importData, getUsers, addUser as addCloudUser, deleteUser as deleteCloudUser, updateUser } from '../lib/api'
import { defaultMedicines } from '../lib/defaultMedicines'
import type { Medicine, Prescription, PrescriptionItem } from '../types'

export default function Home() {
  const [medicines, setMedicines] = useState<Medicine[]>([])
  const [prescriptionItems, setPrescriptionItems] = useState<PrescriptionItem[]>([])
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([])
  const [formulas, setFormulas] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  
  const [patientInfo, setPatientInfo] = useState({
    name: '',
    gender: '男',
    age: '',
    phone: '',
    address: '',
    diagnosis: '',
    doseCount: 7,
    medicalFee: 0,
    doctorName: '',
    prescriptionNo: '',
    clinicNo: '',
    visitDate: new Date().toLocaleDateString('zh-CN'),
    medicalHistory: ''
  })
  
  const [searchKeyword, setSearchKeyword] = useState('')
  
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [showMedicineModal, setShowMedicineModal] = useState(false)
  const [showFormulaModal, setShowFormulaModal] = useState(false)
  const [showBackupModal, setShowBackupModal] = useState(false)
  const [showCaseModal, setShowCaseModal] = useState(false)
  
  const [clinicName, setClinicName] = useState('惠康堂中医诊所')
  
  const [currentEditIndex, setCurrentEditIndex] = useState(-1)
  const [currentSearchColumn, setCurrentSearchColumn] = useState('code')
  const [searchResults, setSearchResults] = useState<Medicine[]>([])
  const [selectedSearchIndex, setSelectedSearchIndex] = useState(0)
  const [searchDropdownVisible, setSearchDropdownVisible] = useState(false)
  const [dropdownPosition, setDropdownPosition] = useState({ left: 0, top: 0, width: 0 })
  
  const [caseSearchName, setCaseSearchName] = useState('')
  const [caseDateStart, setCaseDateStart] = useState('')
  const [caseDateEnd, setCaseDateEnd] = useState('')
  
  const hashPassword = (password: string): string => {
    let hash = 0
    for (let i = 0; i < password.length; i++) {
      const char = password.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return Math.abs(hash).toString(16)
  }
  
  const defaultUsers = [
    { username: 'admin', password: hashPassword('admin123'), name: '管理员' },
    { username: 'doctor1', password: hashPassword('doctor123'), name: '张医生' },
    { username: 'doctor2', password: hashPassword('doctor123'), name: '李医生' },
  ]
  
  const getInitialUsers = () => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('cloudUsers')
      return saved ? JSON.parse(saved) : defaultUsers
    }
    return defaultUsers
  }
  
  const [users, setUsers] = useState<{ id?: number; username: string; password: string; name: string }[]>(getInitialUsers)
  
  const [currentUser, setCurrentUser] = useState<{ username: string; password: string; name: string } | null>(null)
  const [loginUsername, setLoginUsername] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  
  const [showUserModal, setShowUserModal] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newName, setNewName] = useState('')
  
  const [showChangePwdModal, setShowChangePwdModal] = useState(false)
  const [oldPassword, setOldPassword] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [pwdError, setPwdError] = useState('')
  
  const inputRefs = useRef<{ [key: number]: HTMLInputElement | null }>({})
  
  const setInputRef = (el: HTMLInputElement | null, index: number) => {
    inputRefs.current[index] = el
  }

  useEffect(() => {
    const savedUser = localStorage.getItem('currentUser')
    if (savedUser && users.length > 0) {
      const user = JSON.parse(savedUser)
      if (users.find(u => u.username === user.username && u.password === user.password)) {
        setCurrentUser(user)
      }
    }
    loadData()
    loadUsers()
    generatePrescriptionNo()
  }, [])
  
  const handleLogin = () => {
    const hashedPassword = hashPassword(loginPassword)
    const user = users.find(u => u.username === loginUsername && u.password === hashedPassword)
    if (user) {
      setCurrentUser(user)
      setLoginError('')
      localStorage.setItem('currentUser', JSON.stringify(user))
    } else {
      setLoginError('用户名或密码错误！')
    }
  }
  
  const addUser = async () => {
    if (!newUsername || !newPassword || !newName) {
      alert('请填写完整信息！')
      return
    }
    if (users.find(u => u.username === newUsername)) {
      alert('用户名已存在！')
      return
    }
    try {
      const hashedPassword = hashPassword(newPassword)
      const newUser = { username: newUsername, password: hashedPassword, name: newName }
      const newUsers = [...users, newUser]
      setUsers(newUsers)
      localStorage.setItem('cloudUsers', JSON.stringify(newUsers))
      setNewUsername('')
      setNewPassword('')
      setNewName('')
      alert('用户添加成功！')
    } catch (error) {
      console.error('Failed to add user:', error)
      alert('添加用户失败！')
    }
  }
  
  const deleteUser = async (username: string, userId?: number) => {
    if (username === 'admin') {
      alert('不能删除管理员！')
      return
    }
    if (!confirm('确定删除该用户？')) return
    try {
      if (userId) {
        await deleteCloudUser(userId)
      }
      const newUsers = users.filter(u => u.username !== username)
      setUsers(newUsers)
      localStorage.setItem('cloudUsers', JSON.stringify(newUsers))
      localStorage.removeItem('currentUser')
    } catch (error) {
      console.error('Failed to delete user:', error)
      alert('删除用户失败！')
    }
  }
  
  const changePassword = async () => {
    setPwdError('')
    
    if (!oldPassword || !newPwd || !confirmPwd) {
      setPwdError('请填写所有字段！')
      return
    }
    
    if (newPwd !== confirmPwd) {
      setPwdError('两次输入的密码不一致！')
      return
    }
    
    if (!currentUser) return
    
    const hashedOldPassword = hashPassword(oldPassword)
    const user = users.find(u => u.username === currentUser.username && u.password === hashedOldPassword)
    if (!user) {
      setPwdError('原密码错误！')
      return
    }
    
    try {
      const hashedNewPassword = hashPassword(newPwd)
      const updatedUsers = users.map(u => 
        u.username === currentUser.username 
          ? { ...u, password: hashedNewPassword }
          : u
      )
      setUsers(updatedUsers)
      localStorage.setItem('cloudUsers', JSON.stringify(updatedUsers))
      const updatedUser = { ...currentUser, password: hashedNewPassword }
      localStorage.setItem('currentUser', JSON.stringify(updatedUser))
      
      setOldPassword('')
      setNewPwd('')
      setConfirmPwd('')
      setShowChangePwdModal(false)
      alert('密码修改成功！')
    } catch (error) {
      console.error('Failed to change password:', error)
      alert('密码修改失败！')
    }
  }
  
  useEffect(() => {
    if (prescriptionItems.length === 0 && !loading) {
      const emptyItems = Array(11).fill(null).map(() => ({
        medicine_name: '',
        medicine_code: '',
        dosage: 10,
        unit: 'g',
        price: 0,
        total: 0
      }))
      setPrescriptionItems(emptyItems)
    }
  }, [loading])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F1' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        setShowSettingsModal(true)
      } else if (e.key === 'F2' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        setShowMedicineModal(true)
      } else if (e.key === 'F3' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        setShowFormulaModal(true)
      } else if (e.key === 'F5' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        saveAsFormula()
      } else if (e.key === 'F7' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        clearForm()
      } else if (e.key === 'F8' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        printPrescription()
      } else if (e.key === 'F9' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        savePrescription()
      } else if (e.key === 'Escape') {
        setSearchDropdownVisible(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [prescriptionItems, patientInfo])

  const loadData = async () => {
    try {
      setLoading(true)
      const [meds, pres, forms] = await Promise.all([getMedicines(), getPrescriptions(), getFormulas()])
      setMedicines(meds)
      setPrescriptions(pres)
      setFormulas(forms)
    } catch (error) {
      console.error('Failed to load data:', error)
      setMedicines(defaultMedicines)
    } finally {
      setLoading(false)
    }
  }

  const loadUsers = async () => {
    try {
      const cloudUsers = await getUsers()
      if (typeof window !== 'undefined') {
        const savedUsers = localStorage.getItem('cloudUsers')
        if (savedUsers) {
          setUsers(JSON.parse(savedUsers))
          return
        }
      }
      if (cloudUsers && cloudUsers.length > 0) {
        setUsers(cloudUsers)
      }
    } catch (error) {
      console.error('Failed to load users:', error)
    }
  }

  const generatePrescriptionNo = () => {
    const now = new Date()
    const year = now.getFullYear().toString().slice(-2)
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    const today = year + month + day
    
    const storedDate = localStorage.getItem('prescriptionDate')
    const storedCount = localStorage.getItem('prescriptionCount')
    
    let count = 1
    if (storedDate === today && storedCount) {
      count = parseInt(storedCount)
    } else if (storedDate !== today) {
      localStorage.setItem('prescriptionDate', today)
      localStorage.setItem('prescriptionCount', '1')
    }
    
    const seqNo = String(count).padStart(4, '0')
    const newNo = today + seqNo
    
    setPatientInfo(prev => {
      if (prev.prescriptionNo) {
        return prev
      }
      return { ...prev, prescriptionNo: newNo }
    })
  }

  const removePrescriptionItem = (index: number) => {
    const newItems = [...prescriptionItems]
    newItems[index] = { medicine_name: '', medicine_code: '', dosage: 10, unit: 'g', price: 0, total: 0 }
    setPrescriptionItems(newItems)
  }

  const updatePrescriptionItem = (index: number, field: keyof PrescriptionItem, value: any) => {
    const newItems = [...prescriptionItems]
    newItems[index] = { ...newItems[index], [field]: value }
    
    if (field === 'medicine_name' && value) {
      const medicine = medicines.find(m => m.name === value)
      if (medicine) {
        newItems[index].medicine_code = medicine.code || ''
        newItems[index].price = medicine.price || 0
        newItems[index].unit = medicine.unit || 'g'
        newItems[index].dosage = medicine.dosage || 10
        newItems[index].total = Number(medicine.price || 0) * Number(newItems[index].dosage || 0)
      }
    }
    
    if (field === 'medicine_code' && value) {
      const filtered = medicines.filter(m => m.code && m.code.toLowerCase().startsWith(value.toLowerCase()))
      if (filtered.length > 0) {
        setSearchResults(filtered)
        setSelectedSearchIndex(0)
        setSearchDropdownVisible(true)
      } else {
        setSearchDropdownVisible(false)
      }
    }
    
    if (field === 'dosage') {
      newItems[index].total = Number(newItems[index].price || 0) * Number(value || 0)
    }
    
    if (field === 'price') {
      newItems[index].total = Number(value || 0) * Number(newItems[index].dosage || 0)
    }
    
    setPrescriptionItems(newItems)
  }

  const savePrescription = async () => {
    if (!patientInfo.name) {
      alert('请填写患者姓名')
      return
    }
    
    const validItems = prescriptionItems.filter(item => item.medicine_name)
    if (validItems.length === 0) {
      alert('请添加至少一种药物')
      return
    }

    const totalAmount = validItems.reduce((sum, item) => sum + Number(item.total || 0), 0) + Number(patientInfo.medicalFee || 0)
    
    const prescription: Omit<Prescription, 'id'> = {
      prescription_no: patientInfo.prescriptionNo,
      patient_name: patientInfo.name,
      patient_gender: patientInfo.gender,
      patient_age: patientInfo.age,
      patient_phone: patientInfo.phone,
      patient_address: patientInfo.address,
      diagnosis: patientInfo.diagnosis,
      dose_count: patientInfo.doseCount,
      medical_fee: patientInfo.medicalFee,
      doctor_name: currentUser?.name || patientInfo.doctorName,
      total_amount: totalAmount,
      created_at: new Date().toISOString()
    }

    try {
      await addPrescription(prescription, validItems)
      await loadData()
      
      const storedCount = localStorage.getItem('prescriptionCount')
      if (storedCount) {
        const newCount = parseInt(storedCount) + 1
        localStorage.setItem('prescriptionCount', newCount.toString())
      }
      
      alert('处方保存成功！')
      clearForm()
    } catch (error) {
      console.error('Failed to save prescription:', error)
      alert('保存失败')
    }
  }

  const clearForm = () => {
    setPatientInfo({
      name: '',
      gender: '男',
      age: '',
      phone: '',
      address: '',
      diagnosis: '',
      doseCount: 7,
      medicalFee: 0,
      doctorName: '',
      prescriptionNo: '',
      clinicNo: '',
      visitDate: new Date().toLocaleDateString('zh-CN'),
      medicalHistory: ''
    })
    setPrescriptionItems([])
    generatePrescriptionNo()
  }

  const printPrescription = () => {
    window.print()
  }

  const saveAsFormula = () => {
    const validItems = prescriptionItems.filter(item => item.medicine_name)
    if (validItems.length === 0) {
      alert('请先添加药物')
      return
    }

    const formulaName = prompt('请输入验方名称：')
    if (!formulaName) return

    const formulaCode = formulaName.substring(0, 5).toLowerCase()
    const newFormula = {
      name: formulaName,
      code: formulaCode,
      effect: '',
      indication: '',
      compositions: validItems.map(item => ({
        medicine_name: item.medicine_name,
        dosage: item.dosage,
        unit: item.unit
      }))
    }

    setFormulas(prev => [...prev, newFormula])
    alert('验方保存成功！')
  }

  const showAddMedicineForm = () => {
    const name = prompt('药品名称：')
    if (!name) return

    const code = prompt('简码：')
    if (!code) return

    const price = parseFloat(prompt('单价：') || '0')
    const unit = prompt('单位（默认g）：') || 'g'
    const dosage = parseInt(prompt('常用剂量：') || '10')

    const newMedicine = {
      id: Date.now(),
      name,
      code: code.toUpperCase(),
      price,
      unit,
      dosage
    }

    setMedicines(prev => [...prev, newMedicine])
    alert('药品添加成功！')
  }

  const showBatchStockForm = () => {
    const type = confirm('确认批量入库？\n取消则为批量出库')
    const isIn = type === true

    const inputStr = prompt(`请输入批量${isIn ? '入库' : '出库'}数据（每行一个药品，格式：药品名称|数量）\n例如：\n人参|100\n黄芪|50\n当归|80`)
    if (!inputStr) return

    const lines = inputStr.split('\n')
    let success = 0
    let failed = 0

    lines.forEach(line => {
      const [name, countStr] = line.split('|')
      if (name && countStr) {
        const count = parseInt(countStr)
        const index = medicines.findIndex(m => m.name === name.trim())
        if (index !== -1) {
          const newMedicines = [...medicines]
          newMedicines[index].stock = (newMedicines[index].stock || 0) + (isIn ? count : -count)
          setMedicines(newMedicines)
          success++
        } else {
          failed++
        }
      }
    })

    alert(`操作完成！\n成功：${success} 种药品\n失败：${failed} 种药品`)
  }

  const exportMedicines = () => {
    const data = JSON.stringify(medicines, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '药品数据_' + new Date().toLocaleDateString() + '.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const importMedicines = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const importedMedicines = JSON.parse(event.target?.result as string)
        setMedicines(prev => [...prev, ...importedMedicines])
        alert('药品导入成功！')
      } catch (error) {
        alert('导入失败，请确保文件格式正确')
      }
    }
    reader.readAsText(file)
  }

  const clearMedicineLibrary = () => {
    if (!confirm('确定清空所有药品数据？此操作不可恢复！')) return
    setMedicines([])
    alert('药物库已清空')
  }

  const copyData = () => {
    const data = JSON.stringify({
      medicines,
      prescriptions,
      formulas
    }, null, 2)
    navigator.clipboard.writeText(data).then(() => {
      alert('数据已复制到剪贴板！')
    }).catch(() => {
      alert('复制失败，请手动复制')
    })
  }

  const clearAllData = () => {
    if (!confirm('确定清空所有数据？此操作不可恢复！')) return
    setMedicines([])
    setPrescriptions([])
    setFormulas([])
    alert('所有数据已清空')
  }

  const deleteCurrentCase = () => {
    if (!patientInfo.name) {
      alert('请先输入患者姓名')
      return
    }
    
    if (!confirm(`确定删除患者「${patientInfo.name}」的所有病历记录？`)) return
    
    setPrescriptions(prev => prev.filter(p => p.patient_name !== patientInfo.name))
    alert('病历已删除')
  }

  const calculatePerDose = () => {
    return prescriptionItems.reduce((sum, item) => sum + Number(item.total || 0), 0)
  }

  const calculateMedicineTotal = () => {
    const perDose = calculatePerDose()
    return perDose * Number(patientInfo.doseCount || 7)
  }

  const calculateTotal = () => {
    const medicineTotal = calculateMedicineTotal()
    return medicineTotal + Number(patientInfo.medicalFee || 0)
  }

  const exportData = async () => {
    try {
      const data = await exportAllData()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = '中医处方数据_' + new Date().toLocaleDateString() + '.json'
      a.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Failed to export data:', error)
      alert('导出失败')
    }
  }

  const importDataHandler = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    const reader = new FileReader()
    reader.onload = async (event) => {
      try {
        const data = JSON.parse(event.target?.result as string)
        await importData(data)
        await loadData()
        await loadUsers()
        alert('导入成功！请刷新页面查看最新数据。')
      } catch (error) {
        console.error('Failed to import data:', error)
        alert('导入失败')
      }
    }
    reader.readAsText(file)
  }

  const filteredMedicines = medicines.filter(m => 
    m.name.includes(searchKeyword) || m.code.includes(searchKeyword.toUpperCase())
  )

  const filteredPrescriptions = prescriptions.filter(p => 
    p.patient_name.includes(searchKeyword) || p.diagnosis.includes(searchKeyword)
  )

  const filteredFormulas = formulas.filter((f: any) => 
    f.name.includes(searchKeyword) || (f.effect && f.effect.includes(searchKeyword))
  )

  const filteredCases = prescriptions.filter(p => {
    let match = true
    if (caseSearchName) {
      match = match && p.patient_name.toLowerCase().includes(caseSearchName.toLowerCase())
    }
    if (caseDateStart && p.created_at) {
      match = match && p.created_at >= caseDateStart
    }
    if (caseDateEnd && p.created_at) {
      match = match && p.created_at <= caseDateEnd
    }
    return match
  })

  const perDose = calculatePerDose()
  const medicineTotal = calculateMedicineTotal()
  const totalAmount = calculateTotal()

  const startSearch = (index: number, column: string, event: React.FocusEvent<HTMLInputElement>) => {
    setCurrentEditIndex(index)
    setCurrentSearchColumn(column)
    const value = event.target.value
    if (value.length >= 1) {
      showSearchDropdown(value, column, event.target)
    }
  }

  const showSearchDropdown = (query: string, column: string, element: HTMLInputElement) => {
    const rect = element.getBoundingClientRect()
    setDropdownPosition({
      left: rect.left,
      top: rect.bottom + 2,
      width: rect.width
    })

    if (!query.trim()) {
      setSearchDropdownVisible(false)
      return
    }

    let filtered: Medicine[]
    if (column === 'code') {
      const queryLower = query.toLowerCase().trim()
      filtered = medicines.filter(m => m.code && m.code.toLowerCase().startsWith(queryLower))
    } else {
      filtered = medicines.filter(m => m.name && m.name.includes(query))
    }

    if (filtered.length > 0) {
      setSearchResults(filtered)
      setSelectedSearchIndex(0)
      setSearchDropdownVisible(true)
    } else {
      setSearchDropdownVisible(false)
    }
  }

  const handleSearchKey = (event: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedSearchIndex(prev => Math.min(prev + 1, searchResults.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedSearchIndex(prev => Math.max(prev - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      selectSearchResult(index)
    } else if (event.key === 'Tab') {
      event.preventDefault()
      if (index >= prescriptionItems.length - 3) {
        addEmptyRow()
      }
      setSearchDropdownVisible(false)
    } else {
      const target = event.target as HTMLInputElement
      showSearchDropdown(target.value, 'code', target)
    }
  }

  const selectSearchResult = (index: number) => {
    const selectedMedicine = searchResults[selectedSearchIndex]
    if (!selectedMedicine) return

    const exists = prescriptionItems.some((item, i) => i !== index && item.medicine_name === selectedMedicine.name)
    if (exists) {
      alert('该药物已在处方中，不能重复添加！')
      setSearchDropdownVisible(false)
      return
    }

    const newItems = [...prescriptionItems]
    newItems[index] = {
      medicine_name: selectedMedicine.name,
      medicine_code: (selectedMedicine.code || '').toLowerCase(),
      dosage: selectedMedicine.dosage || 10,
      unit: selectedMedicine.unit || 'g',
      price: selectedMedicine.price || 0,
      total: Number(selectedMedicine.price || 0) * Number(selectedMedicine.dosage || 10)
    }
    
    if (index >= prescriptionItems.length - 3) {
      newItems.push({
        medicine_name: '',
        medicine_code: '',
        dosage: 10,
        unit: 'g',
        price: 0,
        total: 0
      })
    }
    
    setPrescriptionItems(newItems)
    setSearchDropdownVisible(false)
    
    setTimeout(() => {
      const nextInput = inputRefs.current[index + 1]
      if (nextInput) {
        nextInput.focus()
      }
    }, 50)
  }

  const addEmptyRow = () => {
    const newItems = [...prescriptionItems, {
      medicine_name: '',
      medicine_code: '',
      dosage: 10,
      unit: 'g',
      price: 0,
      total: 0
    }]
    setPrescriptionItems(newItems)
  }

  const loadHistory = (prescription: Prescription) => {
    setPatientInfo({
      ...patientInfo,
      name: prescription.patient_name,
      gender: prescription.patient_gender || '男',
      age: prescription.patient_age,
      phone: prescription.patient_phone || '',
      address: prescription.patient_address || '',
      clinicNo: '',
      diagnosis: prescription.diagnosis,
      doseCount: prescription.dose_count || 7,
      doctorName: prescription.doctor_name || '',
      medicalHistory: ''
    })
    setShowCaseModal(false)
  }

  const deleteCase = (id: string | number) => {
    if (!confirm('确定删除该病历？')) return
    setPrescriptions(prev => prev.filter(p => p.id !== id))
  }

  const searchCases = () => {
    loadData()
  }

  const resetCaseSearch = () => {
    setCaseSearchName('')
    setCaseDateStart('')
    setCaseDateEnd('')
  }

  if (!currentUser) {
    return (<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#f0f0f0' }}>
        <div style={{ background: 'white', padding: '40px', borderRadius: '10px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)' }}>
          <h2 style={{ textAlign: 'center', marginBottom: '20px', color: '#8b0000' }}>中医处方系统</h2>
          <input type="text" placeholder="用户名" value={loginUsername} onChange={(e) => setLoginUsername(e.target.value)} style={{ width: '250px', padding: '10px', fontSize: '16px', border: '1px solid #ccc', borderRadius: '5px', marginBottom: '10px' }} />
          <br />
          <input type="password" placeholder="密码" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleLogin()} style={{ width: '250px', padding: '10px', fontSize: '16px', border: '1px solid #ccc', borderRadius: '5px', marginBottom: '10px' }} />
          <br />
          <button onClick={handleLogin} style={{ width: '250px', padding: '10px', background: '#008000', color: 'white', border: 'none', borderRadius: '5px', fontSize: '16px', cursor: 'pointer' }}>登录</button>
          {loginError && (<p style={{ color: 'red', textAlign: 'center', marginTop: '10px' }}>{loginError}</p>)}
        </div>
      </div>)
  }

  if (loading) {
    return (<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <div>加载中...</div>
      </div>)
  }

  return (<div>
      <div className="top-tabs">
        <div className="tab-item" onClick={() => setShowSettingsModal(true)}>【基础设置】</div>
        <div className="tab-item" onClick={() => setShowCaseModal(true)}>【病例管理】</div>
        <div className="tab-item" onClick={() => setShowMedicineModal(true)}>【药品管理】</div>
        <div className="tab-item" onClick={() => setShowFormulaModal(true)}>【验方设置】</div>
        <div className="tab-item" onClick={() => setShowBackupModal(true)}>【数据管理】</div>
        {currentUser?.username === 'admin' && (
          <div className="tab-item" onClick={() => setShowUserModal(true)}>【用户管理】</div>
        )}
        <div className="tab-item" onClick={() => alert('快捷键：F1-设置 F2-药品 F3-验方 F7-重输 F8-打印 F9-保存')}>【系统帮助】</div>
        <div className="tab-item" style={{background:'#ffdddd',color:'#8b0000'}} onClick={() => { localStorage.removeItem('currentUser'); setCurrentUser(null); }}>【退出登录】</div>
        <div className="tab-hint">
          当前用户: <span style={{color:'#008000',fontWeight:'bold'}}>{currentUser?.name}</span> | 
          <kbd>F1</kbd>设置 <kbd>F2</kbd>药品 <kbd>F3</kbd>验方 <kbd>F7</kbd>重输 <kbd>F8</kbd>打印 <kbd>F9</kbd>保存
        </div>
      </div>

      <div className="top-tabs-right">
        <div className="tab-item" onClick={() => setShowChangePwdModal(true)}>【修改密码】</div>
      </div>

      <div className="main-container">
        <div className="left-panel">
          <div className="top-tabs-left">
            <div className="tab-left-item active">填资料</div>
            <div className="tab-left-item">调原方</div>
            <div className="tab-left-item">调病历</div>
            <div className="tab-left-item">同病搜</div>
          </div>

          <div className="patient-section">
            <div className="patient-row">
              <span className="patient-label" style={{width: 45}}>处方<br/>编号</span>
              <input type="text" value={patientInfo.prescriptionNo} className="patient-input xxx-small" readOnly />
              <span className="patient-label">性别</span>
              <select value={patientInfo.gender} onChange={(e) => setPatientInfo(prev => ({...prev, gender: e.target.value}))} className="patient-input">
                <option value="男">男</option>
                <option value="女">女</option>
              </select>
              <span className="patient-label">日期</span>
              <input type="text" value={patientInfo.visitDate} className="patient-input xxx-small" readOnly />
            </div>
            <div className="patient-row">
              <span className="patient-label">姓名</span>
              <input type="text" value={patientInfo.name} onChange={(e) => setPatientInfo(prev => ({...prev, name: e.target.value}))} className="patient-input" />
              <span className="patient-label">年龄</span>
              <input type="text" value={patientInfo.age} onChange={(e) => setPatientInfo(prev => ({...prev, age: e.target.value}))} className="patient-input xx-small" />
              <span className="patient-label">电话</span>
              <input type="text" value={patientInfo.phone} onChange={(e) => setPatientInfo(prev => ({...prev, phone: e.target.value}))} className="patient-input small" />
            </div>
            <div className="patient-row">
              <span className="patient-label">编号</span>
              <input type="text" value={patientInfo.clinicNo} onChange={(e) => setPatientInfo(prev => ({...prev, clinicNo: e.target.value}))} className="patient-input xx-small" />
              <span className="patient-label">住址</span>
              <input type="text" value={patientInfo.address} onChange={(e) => setPatientInfo(prev => ({...prev, address: e.target.value}))} className="patient-input" style={{flex: 2}} />
            </div>
          </div>

          <div className="symptom-section">
            <div className="history-tabs">
              <div className="history-tab active">病史记录</div>
              <div className="history-tab">修改病史</div>
            </div>
            <textarea value={patientInfo.medicalHistory} onChange={(e) => setPatientInfo(prev => ({...prev, medicalHistory: e.target.value}))} className="symptom-textarea" />
          </div>

          <div className="diagnosis-section">
            <div className="patient-row">
              <span className="patient-label">诊断</span>
              <input type="text" value={patientInfo.diagnosis} onChange={(e) => setPatientInfo(prev => ({...prev, diagnosis: e.target.value}))} className="patient-input" style={{flex: 1}} />
              <span className="patient-label">金额</span>
              <input type="text" value={totalAmount.toFixed(2)} className="patient-input xx-small" readOnly />
              <span className="patient-label">医师</span>
              <input type="text" value={patientInfo.doctorName} onChange={(e) => setPatientInfo(prev => ({...prev, doctorName: e.target.value}))} className="patient-input xx-small" />
            </div>
          </div>

          <div className="action-buttons-section">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <button className="small-btn" onClick={deleteCurrentCase}>删除处方病历</button>
              <span style={{fontSize:10}}>自动查找</span>
              <select className="small-btn" style={{fontSize:10}}>
                <option>姓名</option>
              </select>
              <button className="small-btn" onClick={() => setPrescriptionItems(Array(11).fill(null).map(() => ({ medicine_name: '', medicine_code: '', dosage: 10, unit: 'g', price: 0, total: 0 })))}>一键删除所有药物</button>
            </div>
          </div>

          <div className="medicine-section">
            <div style={{background:'#d0d0d0',padding:'3px 8px',fontSize:10,borderBottom:'1px solid #808080'}}>
              提示: 在简码栏输入简码，在药名栏输入药名
            </div>
            
            <div className="medicine-table-container">
              <table className="medicine-table">
                <thead>
                  <tr>
                    <th style={{width:'25px'}}>#</th>
                    <th style={{width:'45px'}}>简码</th>
                    <th style={{width:'90px'}}>药物</th>
                    <th style={{width:'40px'}}>数量</th>
                    <th style={{width:'30px'}}>单位</th>
                    <th style={{width:'40px'}}>单价</th>
                    <th style={{width:'45px'}}>合计</th>
                    <th style={{width:'30px'}}>删</th>
                  </tr>
                </thead>
                <tbody>
                  {prescriptionItems.map((item, index) => (
                    <tr key={index}>
                      <td style={{textAlign:'center',color:'#999'}}>{index + 1}</td>
                      <td>
                        <input 
                          type="text" 
                          value={item.medicine_code}
                          onChange={(e) => updatePrescriptionItem(index, 'medicine_code', e.target.value)}
                          onFocus={(e) => startSearch(index, 'code', e)}
                          onKeyDown={(e) => handleSearchKey(e, index)}
                          onBlur={() => setTimeout(() => setSearchDropdownVisible(false), 200)}
                          ref={(el) => setInputRef(el, index)}
                        />
                      </td>
                      <td>
                        <input 
                          type="text" 
                          value={item.medicine_name}
                          onChange={(e) => updatePrescriptionItem(index, 'medicine_name', e.target.value)}
                          onFocus={(e) => startSearch(index, 'name', e)}
                          onKeyDown={(e) => handleSearchKey(e, index)}
                          onBlur={() => setTimeout(() => setSearchDropdownVisible(false), 200)}
                        />
                      </td>
                      <td>
                        {item.medicine_name ? (
                          <input 
                            type="number" 
                            min="0"
                            value={item.dosage}
                            onChange={(e) => updatePrescriptionItem(index, 'dosage', Number(e.target.value))}
                          />
                        ) : (
                          ''
                        )}
                      </td>
                      <td style={{textAlign: 'center'}}>{item.medicine_name ? 'g' : ''}</td>
                      <td>
                        {item.medicine_name ? (
                          <input 
                            type="number" 
                            step="0.01"
                            value={item.price}
                            onChange={(e) => updatePrescriptionItem(index, 'price', Number(e.target.value))}
                          />
                        ) : (
                          ''
                        )}
                      </td>
                      <td>{item.medicine_name ? item.total.toFixed(2) : ''}</td>
                      <td style={{textAlign:'center'}}>
                        <button className="small-btn delete-btn" onClick={() => removePrescriptionItem(index)}>删</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="center-panel">
          <div className="prescription-paper">
            <div className="clinic-name">{clinicName}</div>
            <div className="prescription-title">处 方 笺</div>
            
            <div className="prescription-info">
              <div>姓名: {patientInfo.name || '________'}</div>
              <div>性别: {patientInfo.gender}</div>
              <div>年龄: {patientInfo.age || '__'}岁</div>
              <div>科别: 中医内科</div>
              <div>门诊号: {patientInfo.prescriptionNo || '________'}</div>
              <div>日期: {patientInfo.visitDate}</div>
            </div>

            <div style={{marginBottom:8}}>
              <span>诊断: {patientInfo.diagnosis || '________________'}</span>
            </div>

            <div className="prescription-grid">
              <div className="prescription-line" style={{borderBottom:'1px solid #000', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                <div className="rp-mark">RP</div>
                <div></div>
                <div className="dose-count">{patientInfo.doseCount}剂</div>
              </div>
              <div className="prescription-grid-inner">
                {prescriptionItems.filter(item => item.medicine_name).map((item, index) => (
                  <div key={`${index}-${item.medicine_name}-${item.dosage}`} className="prescription-line">
                    {item.medicine_name} {item.dosage}{item.unit}
                  </div>
                ))}
                {prescriptionItems.filter(item => item.medicine_name).length === 0 && (
                  <div className="prescription-line">（空白处方）</div>
                )}
              </div>
            </div>

            <div className="prescription-footer">
              <div className="usage-text">用法: 水煎服，日一剂，早晚分服</div>
              <div className="signature-row">
                <span>医师: {patientInfo.doctorName || '________'}（签字）</span>
                <span>配方: ________ 复核: ________</span>
              </div>
            </div>
          </div>
        </div>

        <div className="right-panel">
          <div className="history-header">处方历史</div>
          <div className="history-list">
            {prescriptions.slice(0, 20).map((prescription, index) => (
              <div 
                key={prescription.id || index} 
                className="history-item"
                onClick={() => loadHistory(prescription)}
              >
                <div className="history-name">{prescription.patient_name}</div>
                <div className="history-date">{prescription.created_at?.split('T')[0] || ''} | {prescription.diagnosis}</div>
              </div>
            ))}
            {prescriptions.length === 0 && (
              <div style={{textAlign:'center',color:'#999',padding:20,fontSize:11}}>请输入患者姓名</div>
            )}
          </div>
        </div>
      </div>

      <div className="bottom-bar">
        <div className="price-summary">
          <div className="price-item">每剂: <span style={{color:'red',fontWeight:'bold'}}>{perDose.toFixed(2)}</span>元</div>
          <div className="price-item">药费: <span>{medicineTotal.toFixed(2)}</span>元</div>
          <div className="price-item">剂数: <input type="number" value={patientInfo.doseCount} onChange={(e) => setPatientInfo(prev => ({...prev, doseCount: Number(e.target.value)}))} style={{width:40,padding:2,fontWeight:'bold'}} />剂</div>
          <div className="price-item">诊疗费: <input type="number" value={patientInfo.medicalFee} onChange={(e) => setPatientInfo(prev => ({...prev, medicalFee: Number(e.target.value)}))} style={{width:40,padding:2}} />元</div>
          <div className="price-item">总计: <span style={{color:'red',fontWeight:'bold'}}>{totalAmount.toFixed(2)}</span>元</div>
        </div>
        <div className="action-buttons">
          <button className="action-btn" onClick={clearForm}>F7重输</button>
          <button className="action-btn" onClick={saveAsFormula}>F5存验方</button>
          <button className="action-btn" onClick={printPrescription}>F8打印</button>
          <button className="action-btn primary" onClick={savePrescription}>F9保存</button>
        </div>
      </div>

      {searchDropdownVisible && (
        <div 
          className="medicine-search-dropdown"
          style={{ 
            left: dropdownPosition.left, 
            top: dropdownPosition.top, 
            width: dropdownPosition.width,
            display: 'block'
          }}
        >
          {searchResults.map((medicine, index) => (
            <div 
              key={`${medicine.id || medicine.name}-${index}`}
              className={`search-item ${index === selectedSearchIndex ? 'selected' : ''}`}
              onClick={() => {
                selectSearchResult(currentEditIndex)
              }}
            >
              {medicine.name} [{medicine.code.toLowerCase()}] - {(medicine.dosage || 10)}{medicine.unit || 'g'}
            </div>
          ))}
        </div>
      )}

      <div className={showSettingsModal ? 'modal active' : 'modal'}>
        <div className="modal-content">
          <div className="modal-header">
            <span>F1 基础设置</span>
            <span className="close-btn" onClick={() => setShowSettingsModal(false)}>&times;</span>
          </div>
          <div className="modal-body">
            <div style={{marginBottom:12}}>
              <label>诊所名称:</label>
              <input type="text" value={clinicName} onChange={(e) => setClinicName(e.target.value)} style={{width:'100%',padding:6,marginTop:4}} />
            </div>
            <div style={{marginBottom:12}}>
              <label>医师姓名:</label>
              <input type="text" value={patientInfo.doctorName} onChange={(e) => setPatientInfo(prev => ({...prev, doctorName: e.target.value}))} style={{width:'100%',padding:6,marginTop:4}} />
            </div>
            <div style={{marginBottom:12}}>
              <label>默认挂号费:</label>
              <input type="number" value={patientInfo.medicalFee} onChange={(e) => setPatientInfo(prev => ({...prev, medicalFee: Number(e.target.value)}))} style={{width:'100%',padding:6,marginTop:4}} />
            </div>
            <div style={{marginBottom:12}}>
              <label>默认剂数:</label>
              <input type="number" value={patientInfo.doseCount} onChange={(e) => setPatientInfo(prev => ({...prev, doseCount: Number(e.target.value)}))} style={{width:'100%',padding:6,marginTop:4}} />
            </div>
            <hr style={{margin:'15px 0'}} />
            <div style={{textAlign:'center'}}>
              <button className="action-btn" onClick={exportData}>备份数据</button>
              <button className="action-btn" onClick={() => document.getElementById('importBackupFile')?.click()}>恢复数据</button>
              <button className="action-btn" onClick={() => {}} style={{background:'#ffdddd'}}>清空数据</button>
              <input type="file" id="importBackupFile" accept=".json" style={{display:'none'}} onChange={importDataHandler} />
            </div>
          </div>
          <div className="modal-footer">
            <button className="action-btn" onClick={() => setShowSettingsModal(false)}>取消</button>
            <button className="action-btn primary" onClick={() => setShowSettingsModal(false)}>保存</button>
          </div>
        </div>
      </div>

      <div className={showMedicineModal ? 'modal active' : 'modal'}>
        <div className="modal-content">
          <div className="modal-header">
            <span>F2 药品管理</span>
            <span className="close-btn" onClick={() => setShowMedicineModal(false)}>&times;</span>
          </div>
          <div className="modal-body">
            <div style={{marginBottom: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap'}}>
              <input type="text" placeholder="搜索药品..." value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)} className="search-box" style={{flex:1,minWidth:'150px'}} />
              <button className="action-btn" onClick={showAddMedicineForm}>新增药品</button>
              <button className="action-btn" onClick={showBatchStockForm}>批量出入库</button>
              <button className="action-btn" onClick={exportMedicines}>导出药品</button>
              <button className="action-btn" onClick={() => document.getElementById('importMedicineFile')?.click()}>导入药品</button>
              <button className="action-btn" style={{background:'#ff6b6b',color:'white'}} onClick={clearMedicineLibrary}>清空药物库</button>
              <input type="file" id="importMedicineFile" accept=".csv,.json,.xlsx,.xls" style={{display:'none'}} onChange={importMedicines} />
            </div>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>简码</th>
                    <th>名称</th>
                    <th>单价</th>
                    <th>单位</th>
                    <th>常用剂量</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMedicines.map((medicine, index) => (
                    <tr key={`${index}-${medicine.id || medicine.name}-${medicine.code}`}>
                      <td>{medicine.code}</td>
                      <td>{medicine.name}</td>
                      <td>{medicine.price}</td>
                      <td>{medicine.unit}</td>
                      <td>{medicine.dosage}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="modal-footer">
            <button className="action-btn" onClick={() => setShowMedicineModal(false)}>关闭</button>
          </div>
        </div>
      </div>

      <div className={showFormulaModal ? 'modal active' : 'modal'}>
        <div className="modal-content">
          <div className="modal-header">
            <span>F3 验方管理</span>
            <span className="close-btn" onClick={() => setShowFormulaModal(false)}>&times;</span>
          </div>
          <div className="modal-body">
            <div style={{marginBottom:15}}>
              <input type="text" placeholder="搜索方剂..." value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)} className="search-box" style={{width:'100%'}} />
            </div>
            {filteredFormulas.map((formula: any) => (
              <div key={formula.id || formula.name} className="formula-card">
                <div className="formula-name">{formula.name}</div>
                <div className="formula-effect">功效：{formula.effect || ''}</div>
                <div className="formula-compositions">
                  {(formula.compositions || []).map((comp: any, index: number) => (
                    <span key={index}>{comp.medicine_name} {comp.dosage}{comp.unit}{index < (formula.compositions || []).length - 1 ? '、' : ''}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="modal-footer">
            <button className="action-btn" onClick={() => setShowFormulaModal(false)}>关闭</button>
          </div>
        </div>
      </div>

      <div className={showBackupModal ? 'modal active' : 'modal'}>
        <div className="modal-content">
          <div className="modal-header">
            <span>数据管理</span>
            <span className="close-btn" onClick={() => setShowBackupModal(false)}>&times;</span>
          </div>
          <div className="modal-body">
            <div style={{marginBottom:15}}>
              <label>统计范围:</label>
              <select style={{marginLeft:10,padding:4}} defaultValue="month">
                <option value="today">今日</option>
                <option value="week">本周</option>
                <option value="month">本月</option>
                <option value="year">本年</option>
                <option value="all">全部</option>
              </select>
            </div>
            <div style={{marginBottom:20}}>
              <h3>数据统计</h3>
              <p style={{fontSize:12}}>药品数量：{medicines.length} 味</p>
              <p style={{fontSize:12}}>处方数量：{prescriptions.length} 张</p>
              <p style={{fontSize:12}}>方剂数量：{formulas.length} 个</p>
            </div>
            <div style={{marginTop:20,paddingTop:15,borderTop:'1px solid #ccc'}}>
              <h4 style={{marginBottom:10}}>数据备份与恢复</h4>
              <div style={{display:'flex',gap:10}}>
                <button className="action-btn" onClick={exportData} style={{background:'#4CAF50',color:'white'}}>📥 下载数据文件</button>
                <button className="action-btn" onClick={copyData} style={{background:'#FF9800',color:'white'}}>📋 复制数据</button>
                <button className="action-btn" onClick={() => document.getElementById('importDataFile')?.click()} style={{background:'#2196F3',color:'white'}}>📤 导入数据</button>
                <button className="action-btn" onClick={clearAllData} style={{background:'#f44336',color:'white'}}>🗑️ 清空数据</button>
              </div>
              <input type="file" id="importDataFile" accept=".json" style={{display:'none'}} onChange={importDataHandler} />
              <p style={{fontSize:12,color:'#666',marginTop:10}}>提示：复制数据后，打开记事本粘贴并保存为 prescription-data.json 文件</p>
            </div>
          </div>
          <div className="modal-footer">
            <button className="action-btn" onClick={() => setShowBackupModal(false)}>关闭</button>
          </div>
        </div>
      </div>

      <div className={showCaseModal ? 'modal active' : 'modal'}>
        <div className="modal-content">
          <div className="modal-header">
            <span>病例管理</span>
            <span className="close-btn" onClick={() => setShowCaseModal(false)}>&times;</span>
          </div>
          <div className="modal-body">
            <div style={{marginBottom:12,padding:10,background:'#f0f0f0'}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
                <input 
                  type="text" 
                  placeholder="患者姓名"
                  value={caseSearchName}
                  onChange={(e) => setCaseSearchName(e.target.value)}
                />
                <input 
                  type="date" 
                  value={caseDateStart}
                  onChange={(e) => setCaseDateStart(e.target.value)}
                />
                <input 
                  type="date" 
                  value={caseDateEnd}
                  onChange={(e) => setCaseDateEnd(e.target.value)}
                />
              </div>
              <div style={{marginTop:8,display:'flex',gap:8}}>
                <button className="action-btn" onClick={searchCases}>搜索</button>
                <button className="action-btn" onClick={resetCaseSearch}>重置</button>
              </div>
            </div>
            <div style={{overflow:'auto',maxHeight:'350px'}}>
              {filteredCases.map((prescription) => (
                <div 
                  key={prescription.id} 
                  style={{padding:10,borderBottom:'1px solid #d0d0d0',cursor:'pointer'}}
                  onClick={() => loadHistory(prescription)}
                >
                  <div style={{display:'flex',justifyContent:'space-between'}}>
                    <div>
                      <div style={{fontWeight:'bold'}}>{prescription.patient_name}</div>
                      <div style={{fontSize:11,color:'#666'}}>
                        {prescription.created_at?.split('T')[0] || ''} | {prescription.diagnosis || '无诊断'}
                      </div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontWeight:'bold',color:'#8b0000'}}>¥{(prescription.total_amount || 0).toFixed(2)}</div>
                      <button 
                        className="small-btn" 
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteCase(prescription.id!)
                        }}
                      >删除</button>
                    </div>
                  </div>
                </div>
              ))}
              {filteredCases.length === 0 && (
                <div style={{textAlign:'center',padding:20,color:'#999'}}>暂无病历记录</div>
              )}
            </div>
          </div>
          <div className="modal-footer">
            <button className="action-btn" onClick={() => setShowCaseModal(false)}>关闭</button>
          </div>
        </div>
      </div>

      <div className={showUserModal ? 'modal active' : 'modal'}>
        <div className="modal-content">
          <div className="modal-header">
            <span>用户管理</span>
            <span className="close-btn" onClick={() => setShowUserModal(false)}>&times;</span>
          </div>
          <div className="modal-body">
            <div style={{marginBottom:15}}>
              <h3 style={{marginBottom:10}}>添加新用户</h3>
              <input
                type="text"
                placeholder="用户名"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                style={{width:'100%',padding:6,marginBottom:5}}
              />
              <input
                type="password"
                placeholder="密码"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                style={{width:'100%',padding:6,marginBottom:5}}
              />
              <input
                type="text"
                placeholder="医生姓名"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                style={{width:'100%',padding:6,marginBottom:10}}
              />
              <button className="action-btn" onClick={addUser}>添加用户</button>
            </div>
            <div>
              <h3>用户列表</h3>
              <div style={{maxHeight:'200px',overflow:'auto',marginTop:10}}>
                {users.map((user, index) => (
                  <div key={index} style={{display:'flex',justifyContent:'space-between',padding:8,borderBottom:'1px solid #d0d0d0'}}>
                    <div>
                      <div style={{fontWeight:'bold'}}>{user.name}</div>
                      <div style={{fontSize:11,color:'#666'}}>用户名: {user.username}</div>
                    </div>
                    <button 
                      className="small-btn" 
                      onClick={() => deleteUser(user.username, user.id)}
                      disabled={user.username === 'admin'}
                      style={{opacity: user.username === 'admin' ? 0.5 : 1}}
                    >删除</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button className="action-btn" onClick={() => setShowUserModal(false)}>关闭</button>
          </div>
        </div>
      </div>

      <div className={showChangePwdModal ? 'modal active' : 'modal'}>
        <div className="modal-content">
          <div className="modal-header">
            <span>修改密码</span>
            <span className="close-btn" onClick={() => setShowChangePwdModal(false)}>&times;</span>
          </div>
          <div className="modal-body">
            <input
              type="password"
              placeholder="原密码"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              style={{width:'100%',padding:8,marginBottom:10}}
            />
            <input
              type="password"
              placeholder="新密码"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              style={{width:'100%',padding:8,marginBottom:10}}
            />
            <input
              type="password"
              placeholder="确认新密码"
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              style={{width:'100%',padding:8,marginBottom:10}}
            />
            {pwdError && (<p style={{color:'red',textAlign:'center',marginBottom:10}}>{pwdError}</p>)}
          </div>
          <div className="modal-footer">
            <button className="action-btn" onClick={changePassword}>确认修改</button>
            <button className="action-btn" onClick={() => setShowChangePwdModal(false)}>取消</button>
          </div>
        </div>
      </div>
    </div>)
}