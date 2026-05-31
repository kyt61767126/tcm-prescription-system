export async function getNextPrescriptionNo() {
  try {
    const response = await fetch('https://prescription-counter-do.61767126.workers.dev/next-prescription-no');
    if (!response.ok) throw new Error('Failed to fetch');
    const data = await response.json();
    return data.prescriptionNo;
  } catch (error) {
    console.error('Error:', error);
    const now = new Date();
    const yymmdd = now.toISOString().slice(2, 10).replace(/-/g, '');
    return yymmdd + '99';
  }
}