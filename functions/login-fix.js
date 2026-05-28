        async function handleLogin() {
            const username = document.getElementById('loginUsername').value.trim();
            const password = document.getElementById('loginPassword').value;
            const errorDiv = document.getElementById('loginError');
            
            if (!username || !password) {
                errorDiv.textContent = '请输入用户名和密码';
                errorDiv.style.display = 'block';
                return;
            }
            
            try {
                const response = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                
                const result = await response.json();
                
                if (response.ok) {
                    currentUser = result.user;
                    localStorage.setItem('currentUser', JSON.stringify(currentUser));
                    localStorage.setItem('jwtToken', result.token);
                    document.getElementById('loginOverlay').style.display = 'none';
                    updateUserDisplay();
                    errorDiv.style.display = 'none';
                    
                    await loadData();
                    refreshUserInterface();
                    
                    setTimeout(async function() {
                        if (currentUser && localStorage.getItem('jwtToken')) {
                            await syncFromCloud();
                        }
                    }, 500);
                } else {
                    errorDiv.textContent = result.error || '用户名或密码错误';
                    errorDiv.style.display = 'block';
                }
            } catch (error) {
                errorDiv.textContent = '网络错误，请稍后重试';
                errorDiv.style.display = 'block';
            }
        }