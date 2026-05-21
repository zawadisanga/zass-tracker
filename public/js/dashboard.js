// dashboard.js - Complete frontend logic
const API_BASE = '';
let currentToken = localStorage.getItem('token');
let currentDevice = null;
let map = null;
let marker = null;
let socket = null;

// Initialize dashboard
document.addEventListener('DOMContentLoaded', async () => {
    if (!currentToken) {
        window.location.href = '/login.html';
        return;
    }
    
    // Display username
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    document.getElementById('usernameDisplay').innerText = user.username || 'User';
    
    // Initialize socket connection
    initSocket();
    
    // Load devices
    await loadDevices();
    
    // Setup event listeners
    setupEventListeners();
    
    // Load system info
    loadSystemInfo();
    
    // Start auto-refresh (every 30 seconds)
    setInterval(() => {
        if (currentDevice) {
            loadLocations(currentDevice);
            loadStats(currentDevice);
        }
    }, 30000);
});

function initSocket() {
    socket = io();
    
    socket.on('connect', () => {
        console.log('Socket connected');
        if (currentDevice) {
            socket.emit('subscribe', currentDevice);
        }
    });
    
    socket.on(`location-${currentDevice}`, (location) => {
        updateMap(location.lat, location.lng);
        addLocationToList(location);
    });
    
    socket.on(`command-${currentDevice}`, (command) => {
        showNotification(`New command: ${command.command}`);
        loadCommandHistory();
    });
}

async function loadDevices() {
    try {
        const response = await fetch(`${API_BASE}/api/devices`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        const data = await response.json();
        
        if (data.success) {
            const deviceSelect = document.getElementById('deviceSelect');
            const devicesList = document.getElementById('devicesList');
            
            deviceSelect.innerHTML = '<option value="">Select Device</option>';
            
            if (data.devices.length === 0) {
                devicesList.innerHTML = '<p class="empty">No devices registered. Add your first device!</p>';
                document.getElementById('deviceCount').innerText = '0';
                return;
            }
            
            document.getElementById('deviceCount').innerText = data.devices.length;
            
            // Populate device selector
            data.devices.forEach(device => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.textContent = `${device.deviceName} (${device.deviceId.substring(0, 8)}...)`;
                deviceSelect.appendChild(option);
            });
            
            // Populate devices grid
            devicesList.innerHTML = data.devices.map(device => `
                <div class="device-card">
                    <i class="fas fa-mobile-alt"></i>
                    <h3>${device.deviceName}</h3>
                    <p>ID: ${device.deviceId.substring(0, 12)}...</p>
                    <p>Last seen: ${new Date(device.lastSeen).toLocaleString()}</p>
                    <span class="status ${device.status}">${device.status}</span>
                </div>
            `).join('');
            
            // Select first device by default
            if (data.devices.length > 0 && !currentDevice) {
                deviceSelect.value = data.devices[0].deviceId;
                await selectDevice(data.devices[0].deviceId);
            }
        }
    } catch (error) {
        console.error('Error loading devices:', error);
    }
}

async function selectDevice(deviceId) {
    currentDevice = deviceId;
    
    // Resubscribe socket
    if (socket) {
        socket.emit('subscribe', deviceId);
    }
    
    await Promise.all([
        loadLocations(deviceId),
        loadStats(deviceId),
        loadCommandHistory()
    ]);
}

async function loadLocations(deviceId) {
    try {
        const response = await fetch(`${API_BASE}/api/locations/${deviceId}?limit=100`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        const data = await response.json();
        
        if (data.success && data.locations.length > 0) {
            const latest = data.locations[0];
            updateMap(latest.lat, latest.lng);
            displayRecentLocations(data.locations.slice(0, 10));
            document.getElementById('locationCount').innerText = data.locations.length;
        }
    } catch (error) {
        console.error('Error loading locations:', error);
    }
}

async function loadStats(deviceId) {
    try {
        const response = await fetch(`${API_BASE}/api/stats/${deviceId}`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('todayCount').innerText = data.stats.todayLocations || 0;
            document.getElementById('batteryStatus').innerText = data.stats.battery ? `${data.stats.battery}%` : '--';
        }
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

async function loadHistory(deviceId, from, to) {
    try {
        let url = `${API_BASE}/api/locations/${deviceId}?limit=500`;
        if (from) url += `&from=${from}`;
        if (to) url += `&to=${to}`;
        
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        const data = await response.json();
        
        if (data.success) {
            const tbody = document.getElementById('historyTableBody');
            if (data.locations.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5">No history data</td></tr>';
                return;
            }
            
            tbody.innerHTML = data.locations.map(loc => `
                <tr>
                    <td>${new Date(loc.timestamp).toLocaleString()}</td>
                    <td>${loc.lat}</td>
                    <td>${loc.lng}</td>
                    <td>${loc.accuracy}m</td>
                    <td>${loc.battery}%</td>
                </tr>
            `).join('');
        }
    } catch (error) {
        console.error('Error loading history:', error);
    }
}

async function loadCommandHistory() {
    // In production, create endpoint for command history
    const container = document.getElementById('commandList');
    container.innerHTML = '<p>Command history will appear here</p>';
}

async function sendCommand(command, params = {}) {
    if (!currentDevice) {
        alert('Please select a device first');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/command`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify({
                deviceId: currentDevice,
                command: command,
                params: params
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification(`Command "${command}" sent successfully!`);
            loadCommandHistory();
        } else {
            alert('Failed to send command');
        }
    } catch (error) {
        console.error('Error sending command:', error);
        alert('Error sending command');
    }
}

function updateMap(lat, lng) {
    if (!map) {
        map = L.map('map').setView([lat, lng], 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);
    }
    
    if (marker) {
        marker.setLatLng([lat, lng]);
    } else {
        marker = L.marker([lat, lng]).addTo(map);
        marker.bindPopup('Your Device').openPopup();
    }
    
    map.setView([lat, lng], 15);
}

function displayRecentLocations(locations) {
    const container = document.getElementById('recentLocationsList');
    
    if (locations.length === 0) {
        container.innerHTML = '<p class="empty">No locations yet</p>';
        return;
    }
    
    container.innerHTML = locations.map(loc => `
        <div class="location-item">
            <div>
                <strong>📍 ${loc.lat}, ${loc.lng}</strong>
                <div style="font-size: 12px; color: #666;">Accuracy: ${loc.accuracy}m | Battery: ${loc.battery}%</div>
            </div>
            <div style="font-size: 12px; color: #999;">${new Date(loc.timestamp).toLocaleString()}</div>
        </div>
    `).join('');
}

function addLocationToList(location) {
    const container = document.getElementById('recentLocationsList');
    const newItem = document.createElement('div');
    newItem.className = 'location-item';
    newItem.innerHTML = `
        <div>
            <strong>📍 ${location.lat}, ${location.lng}</strong>
            <div style="font-size: 12px; color: #666;">Accuracy: ${location.accuracy}m | Battery: ${location.battery}%</div>
        </div>
        <div style="font-size: 12px; color: #999;">Just now</div>
    `;
    
    container.insertBefore(newItem, container.firstChild);
    if (container.children.length > 10) {
        container.removeChild(container.lastChild);
    }
}

function showNotification(message) {
    // Simple alert for now - can be upgraded to toast notification
    console.log('Notification:', message);
}

async function loadSystemInfo() {
    try {
        const response = await fetch(`${API_BASE}/api/health`);
        const data = await response.json();
        
        document.getElementById('systemInfo').innerHTML = `
            <p><strong>Status:</strong> ${data.status}</p>
            <p><strong>Devices:</strong> ${data.devices}</p>
            <p><strong>Total Locations:</strong> ${data.locations}</p>
            <p><strong>Last Updated:</strong> ${new Date(data.timestamp).toLocaleString()}</p>
        `;
    } catch (error) {
        console.error('Error loading system info:', error);
    }
}

function setupEventListeners() {
    // Device selector
    document.getElementById('deviceSelect').addEventListener('change', (e) => {
        if (e.target.value) {
            selectDevice(e.target.value);
        }
    });
    
    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.dataset.page;
            
            // Update active nav
            document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            
            // Show page
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            document.getElementById(`${page}Page`).classList.add('active');
            
            // Update title
            const titles = {
                dashboard: 'Dashboard',
                devices: 'My Devices',
                history: 'Location History',
                remote: 'Remote Control',
                settings: 'Settings'
            };
            document.getElementById('pageTitle').innerText = titles[page] || 'Dashboard';
            
            // Load page-specific data
            if (page === 'history' && currentDevice) {
                loadHistory(currentDevice);
            }
        });
    });
    
    // Filter history
    document.getElementById('filterHistoryBtn')?.addEventListener('click', () => {
        const from = document.getElementById('historyFrom').value;
        const to = document.getElementById('historyTo').value;
        if (currentDevice) {
            loadHistory(currentDevice, from, to);
        }
    });
    
    // Export history
    document.getElementById('exportHistoryBtn')?.addEventListener('click', async () => {
        if (!currentDevice) return;
        
        const response = await fetch(`${API_BASE}/api/locations/${currentDevice}?limit=5000`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        const data = await response.json();
        
        if (data.success && data.locations.length > 0) {
            let csv = 'Time,Latitude,Longitude,Accuracy,Battery\n';
            data.locations.forEach(loc => {
                csv += `${loc.timestamp},${loc.lat},${loc.lng},${loc.accuracy},${loc.battery}\n`;
            });
            
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `locations_${currentDevice}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        }
    });
    
    // Remote commands
    document.querySelectorAll('.remote-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const command = btn.dataset.command;
            sendCommand(command);
        });
    });
    
    // Change password
    document.getElementById('changePasswordForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const oldPassword = document.getElementById('oldPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        
        if (newPassword !== confirmPassword) {
            alert('New passwords do not match');
            return;
        }
        
        try {
            const response = await fetch(`${API_BASE}/api/change-password`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentToken}`
                },
                body: JSON.stringify({ oldPassword, newPassword })
            });
            
            const data = await response.json();
            
            if (data.success) {
                alert('Password changed successfully! Please login again.');
                localStorage.clear();
                window.location.href = '/login.html';
            } else {
                alert(data.message || 'Failed to change password');
            }
        } catch (error) {
            alert('Error changing password');
        }
    });
    
    // Logout
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
        localStorage.clear();
        window.location.href = '/login.html';
    });
    
    // Add device
    document.getElementById('addDeviceBtn')?.addEventListener('click', () => {
        const deviceId = prompt('Enter device ID (can be any unique identifier):');
        const deviceName = prompt('Enter device name (e.g., My Samsung Phone):');
        
        if (deviceId && deviceName) {
            registerDevice(deviceId, deviceName);
        }
    });
}

async function registerDevice(deviceId, deviceName) {
    try {
        const response = await fetch(`${API_BASE}/api/device/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify({ deviceId, deviceName })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('Device registered successfully!');
            await loadDevices();
        } else {
            alert('Failed to register device');
        }
    } catch (error) {
        alert('Error registering device');
    }
}
