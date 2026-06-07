/**
 * DemocraSchools Client Engine (app.js)
 * Implements Single Page App Router, Authentication Controllers, 
 * Dashboards, SheetJS Excel Integration, and Voting Booth State.
 */

// Application State
const state = {
  configured: true,
  currentUser: null,
  activeView: 'login-view',
  
  // Roster lists
  schools: [],
  inspectSchool: null,
  groups: [],
  teachers: [],
  students: [],
  
  // Student Voting context
  electionInfo: null,
  activeGroups: [],
  votingStep: 0,
  votingSelections: {}, // Maps group_id -> { boy: candidate_id, girl: candidate_id }
  
  // Charts instance
  turnoutChart: null
};

// DOM Content Loaded Handler
document.addEventListener('DOMContentLoaded', () => {
  initRouter();
  initLoginTabs();
  initEventListeners();
  // Trigger initial routing once (handles empty hash on fresh load)
  handleRouting();
  checkSession();
});

/**
 * SPA View Router & Session Watcher
 */
function initRouter() {
  window.addEventListener('hashchange', handleRouting);
}

function handleRouting() {
  const hash = window.location.hash || '#login';
  
  // Ensure DB configured status first
  if (!state.configured && hash !== '#setup') {
    window.location.hash = '#setup';
    return;
  }

  // Route protection
  if (state.configured && hash === '#setup') {
    window.location.hash = '#login';
    return;
  }

  // Route maps to views
  let targetView = 'login-view';
  
  if (hash === '#setup') {
    targetView = 'setup-view';
  } else if (hash === '#login') {
    targetView = 'login-view';
  } else if (hash === '#admin') {
    if (!state.currentUser || state.currentUser.role !== 'admin') { window.location.hash = '#login'; return; }
    targetView = 'admin-view';
    loadAdminDashboard();
  } else if (hash === '#principal') {
    if (!state.currentUser || state.currentUser.role !== 'principal') { window.location.hash = '#login'; return; }
    targetView = 'principal-view';
    loadPrincipalDashboard();
  } else if (hash === '#teacher') {
    if (!state.currentUser || state.currentUser.role !== 'teacher') { window.location.hash = '#login'; return; }
    targetView = 'teacher-view';
    loadTeacherDashboard();
  } else if (hash === '#vote') {
    if (!state.currentUser || state.currentUser.role !== 'booth') { window.location.hash = '#login'; return; }
    targetView = 'student-view';
    loadStudentVotingPortal();
  }

  switchView(targetView);
}

function switchView(viewId) {
  const views = document.querySelectorAll('.view-panel');
  views.forEach(v => {
    if (v.id === viewId) {
      v.classList.remove('hidden');
    } else {
      v.classList.add('hidden');
    }
  });
  state.activeView = viewId;

  // Header element visibilities
  const logoutBtn = document.getElementById('logout-btn');
  const schoolBadge = document.getElementById('school-badge-container');
  
  if (viewId === 'login-view' || viewId === 'setup-view') {
    logoutBtn.classList.add('hidden');
    schoolBadge.classList.add('hidden');
  } else {
    logoutBtn.classList.remove('hidden');
    if (state.currentUser && state.currentUser.school) {
      schoolBadge.textContent = state.currentUser.school.name;
      schoolBadge.classList.remove('hidden');
    } else {
      schoolBadge.classList.add('hidden');
    }
  }
}

async function checkSession() {
  try {
    const res = await fetch('api.php?action=check_session');
    
    if (res.status === 503) {
      // Configuration required
      state.configured = false;
      window.location.hash = '#setup';
      handleRouting();
      return;
    }

    state.configured = true;
    const data = await res.json();
    
    if (data.logged_in) {
      state.currentUser = data;
      // Route based on role — use hash set + explicit call to handle
      // the case where hash hasn't changed (no hashchange event fires)
      if (data.role === 'admin') {
        window.location.hash = '#admin';
        handleRouting();
      } else if (data.role === 'principal') {
        window.location.hash = '#principal';
        handleRouting();
      } else if (data.role === 'teacher') {
        window.location.hash = '#teacher';
        handleRouting();
      } else if (data.role === 'booth') {
        window.location.hash = '#vote';
        handleRouting();
      }
    } else {
      state.currentUser = null;
      window.location.hash = '#login';
      // Always call handleRouting explicitly — hash may not have changed
      handleRouting();
    }
  } catch (err) {
    console.error('Session verify failed:', err);
    state.configured = false;
    window.location.hash = '#setup';
    handleRouting();
  }
}

/**
 * Authentication Portal
 */
function initLoginTabs() {
  const tabs = document.querySelectorAll('.login-tab');
  const cards = document.querySelectorAll('.login-card');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      cards.forEach(c => c.classList.remove('active-card'));

      tab.classList.add('active');
      const role = tab.dataset.role;
      document.getElementById(`${role}-login-card`).classList.add('active-card');
      
      // Reset booth UI state
      const boothGroupContainer = document.getElementById('booth-group-selection-container');
      if (boothGroupContainer) boothGroupContainer.classList.add('hidden');
      const boothSubmitBtn = document.getElementById('btn-booth-submit');
      if (boothSubmitBtn) boothSubmitBtn.textContent = 'Setup Booth';
      const boothForm = document.getElementById('student-login-form');
      if (boothForm) boothForm.reset();

      // Clear alert messages
      const alertBox = document.getElementById('login-message');
      alertBox.classList.add('hidden');
    });
  });
}

function showLoginError(msg) {
  const alertBox = document.getElementById('login-message');
  alertBox.textContent = msg;
  alertBox.classList.remove('hidden');
}

/**
 * API Request Handlers
 */
async function apiPost(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Server error occurred');
  }
  return data;
}

async function apiGet(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Server error occurred');
  }
  return data;
}

/**
 * Event Listeners Registration
 */
function initEventListeners() {
  // Database Setup Submission
  document.getElementById('setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('setup-message');
    msg.classList.add('hidden');
    
    const payload = {
      db_host: document.getElementById('setup-db-host').value,
      db_name: document.getElementById('setup-db-name').value,
      db_user: document.getElementById('setup-db-user').value,
      db_pass: document.getElementById('setup-db-pass').value,
      admin_user: document.getElementById('setup-admin-user').value,
      admin_pass: document.getElementById('setup-admin-pass').value
    };

    try {
      const data = await apiPost('db_setup.php?action=setup', payload);
      msg.className = 'alert-box success-alert';
      msg.textContent = data.message;
      msg.classList.remove('hidden');
      setTimeout(() => {
        checkSession();
      }, 2000);
    } catch (err) {
      msg.className = 'alert-box error-alert';
      msg.textContent = err.message;
      msg.classList.remove('hidden');
    }
  });

  // Universal Logins
  document.getElementById('student-login-form').addEventListener('submit', (e) => handleRoleLogin(e, 'student'));
  document.getElementById('teacher-login-form').addEventListener('submit', (e) => handleRoleLogin(e, 'teacher'));
  document.getElementById('principal-login-form').addEventListener('submit', (e) => handleRoleLogin(e, 'principal'));
  document.getElementById('admin-login-form').addEventListener('submit', (e) => handleRoleLogin(e, 'admin'));

  // Global Logout Button
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await fetch('api.php?action=logout');
    state.currentUser = null;
    window.location.hash = '#login';
  });

  // --- SUPER ADMIN EVENTS ---
  document.getElementById('open-create-school-modal').addEventListener('click', () => {
    openModal('add-school-modal');
  });

  document.getElementById('create-school-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('create-school-message');
    msg.classList.add('hidden');

    const payload = {
      name: document.getElementById('new-school-name').value,
      school_code: document.getElementById('new-school-code').value,
      principal_password: document.getElementById('new-principal-pass').value
    };

    try {
      await apiPost('api.php?action=admin_create_school', payload);
      msg.className = 'alert-box success-alert';
      msg.textContent = 'School registered successfully with 6 default groups!';
      msg.classList.remove('hidden');
      document.getElementById('create-school-form').reset();
      
      loadAdminDashboard();
      setTimeout(() => {
        closeModal('add-school-modal');
      }, 1500);
    } catch (err) {
      msg.className = 'alert-box error-alert';
      msg.textContent = err.message;
      msg.classList.remove('hidden');
    }
  });

  // --- PRINCIPAL EVENTS ---
  document.getElementById('add-teacher-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('teacher-new-user').value;
    const password = document.getElementById('teacher-new-pass').value;

    try {
      await apiPost('api.php?action=principal_add_teacher', { username, password });
      document.getElementById('add-teacher-form').reset();
      loadPrincipalDashboard();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('change-teacher-pass-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const teacher_id = document.getElementById('change-pass-teacher-id').value;
    const password = document.getElementById('change-pass-teacher-newpwd').value;

    try {
      await apiPost('api.php?action=principal_update_teacher', { teacher_id, password });
      closeModal('change-teacher-pass-modal');
      alert('Password updated successfully!');
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('btn-add-group-modal').addEventListener('click', () => {
    openModal('add-group-modal');
  });

  document.getElementById('create-group-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('new-group-name').value;
    const type = document.getElementById('new-group-type').value;

    try {
      await apiPost('api.php?action=principal_add_group', { name, type });
      closeModal('add-group-modal');
      document.getElementById('create-group-form').reset();
      loadPrincipalDashboard();
    } catch (err) {
      alert(err.message);
    }
  });

  // Election States Controllers
  document.getElementById('btn-status-start').addEventListener('click', () => updateElectionStatus('started'));
  document.getElementById('btn-status-mock').addEventListener('click', () => updateElectionStatus('mock'));
  document.getElementById('btn-status-stop').addEventListener('click', () => updateElectionStatus('completed'));
  document.getElementById('btn-status-reset').addEventListener('click', async () => {
    if (confirm('Are you absolutely sure you want to delete all votes and reset student voting logs? This cannot be undone.')) {
      try {
        const data = await apiPost('api.php?action=principal_reset_election', {});
        alert(data.message);
        loadPrincipalDashboard();
      } catch (err) {
        alert(err.message);
      }
    }
  });

  // --- TEACHER EVENTS ---
  document.getElementById('roster-search').addEventListener('input', filterStudentsTable);
  document.getElementById('roster-filter-group').addEventListener('change', filterStudentsTable);

  document.getElementById('btn-add-student-modal').addEventListener('click', () => {
    document.getElementById('student-modal-title').textContent = 'Add Candidate Record';
    document.getElementById('student-detail-form').reset();
    document.getElementById('edit-student-id').value = '';
    
    // In this flow, everyone added is a candidate
    const studentCandidateCheckbox = document.getElementById('edit-student-candidate');
    if (studentCandidateCheckbox) studentCandidateCheckbox.checked = true;
    const subpanel = document.getElementById('candidate-details-subpanel');
    if (subpanel) subpanel.classList.remove('hidden');
    
    document.getElementById('party-symbol-preview').innerHTML = '🌟';
    document.getElementById('edit-candidate-symbol-path').value = '🌟';
    
    // Default assignments
    if (state.groups.length > 0) {
      document.getElementById('edit-student-group').value = state.groups[0].id;
    }
    openModal('student-form-modal');
  });

  document.getElementById('edit-student-candidate').addEventListener('change', (e) => {
    const subpanel = document.getElementById('candidate-details-subpanel');
    if (e.target.checked) {
      subpanel.classList.remove('hidden');
    } else {
      subpanel.classList.add('hidden');
    }
  });

  // Symbol Builder - Emoji Select Change
  document.getElementById('edit-candidate-symbol-emoji').addEventListener('change', (e) => {
    document.getElementById('party-symbol-preview').innerHTML = e.target.value;
    document.getElementById('edit-candidate-symbol-path').value = e.target.value;
  });

  // Symbol Builder - Custom Image File Upload
  document.getElementById('edit-candidate-symbol-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('symbol', file);

    try {
      const res = await fetch('api.php?action=teacher_upload_symbol', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Set image preview
      document.getElementById('party-symbol-preview').innerHTML = `<img src="${data.path}" alt="symbol">`;
      document.getElementById('edit-candidate-symbol-path').value = data.path;
    } catch (err) {
      alert('Symbol upload failed: ' + err.message);
    }
  });

  // Candidate Photo Upload (saves to symbols/ folder)
  document.getElementById('edit-candidate-photo-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const statusEl = document.getElementById('photo-upload-status');
    statusEl.style.display = 'block';
    statusEl.className = 'upload-status-msg uploading';
    statusEl.textContent = '⏳ Uploading photo...';

    const formData = new FormData();
    formData.append('photo', file);

    try {
      const res = await fetch('api.php?action=teacher_upload_candidate_photo', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Show preview
      const preview = document.getElementById('candidate-photo-preview');
      preview.innerHTML = `<img src="${data.path}" alt="Candidate Photo">`;
      document.getElementById('edit-candidate-photo-path').value = data.path;
      document.getElementById('btn-clear-candidate-photo').style.display = 'inline-flex';

      statusEl.className = 'upload-status-msg success';
      statusEl.textContent = '✅ Photo uploaded to symbols/ folder!';
      setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
    } catch (err) {
      statusEl.className = 'upload-status-msg error';
      statusEl.textContent = '❌ Upload failed: ' + err.message;
    }
  });

  // Clear candidate photo
  document.getElementById('btn-clear-candidate-photo').addEventListener('click', () => {
    document.getElementById('candidate-photo-preview').innerHTML = `<span class="photo-placeholder-icon">👤</span><span class="photo-placeholder-text">No photo</span>`;
    document.getElementById('edit-candidate-photo-path').value = '';
    document.getElementById('edit-candidate-photo-file').value = '';
    document.getElementById('btn-clear-candidate-photo').style.display = 'none';
  });

  // Student Detail Form Submit (Create & Update)
  document.getElementById('student-detail-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-student-id').value;
    
    const payload = {
      student_code: document.getElementById('edit-student-code').value,
      name: document.getElementById('edit-student-name').value,
      gender: document.getElementById('edit-student-gender').value,
      group_id: document.getElementById('edit-student-group').value,
      is_candidate: 1, // Everyone standing for election is a candidate
      party_name: document.getElementById('edit-candidate-party').value,
      party_symbol: document.getElementById('edit-candidate-symbol-path').value,
      candidate_photo: document.getElementById('edit-candidate-photo-path').value
    };

    try {
      if (id) {
        // Edit mode
        payload.id = id;
        await apiPost('api.php?action=teacher_edit_student', payload);
        alert('Student record updated successfully.');
      } else {
        // Add mode
        // Excel bulk upsert endpoint can be reused for single manual adds too!
        await apiPost('api.php?action=teacher_upsert_students', { students: [payload] });
        alert('Student record added successfully.');
      }
      closeModal('student-form-modal');
      loadTeacherDashboard();
    } catch (err) {
      alert(err.message);
    }
  });

  // Excel Upload Interactions
  const dropZone = document.getElementById('excel-drop-zone');
  const fileInput = document.getElementById('excel-file-input');

  document.getElementById('btn-trigger-upload').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => handleExcelImport(e.target.files[0]));

  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      handleExcelImport(e.dataTransfer.files[0]);
    }
  });

  // Excel Export Click
  document.getElementById('btn-export-excel').addEventListener('click', exportStudentsToExcel);

  // Template Excel Download
  document.getElementById('btn-download-template').addEventListener('click', downloadExcelTemplate);

  // Mock Sandbox Trigger
  document.getElementById('btn-mock-sandbox').addEventListener('click', () => {
    openMockSandbox();
  });

  document.getElementById('sandbox-select-group').addEventListener('change', renderSandboxCandidates);

  // --- STUDENT VOTING PORTAL EVENTS ---
  document.getElementById('btn-ballot-next').addEventListener('click', handleVotingNext);
  const prevBtn = document.getElementById('btn-ballot-prev');
  if (prevBtn) prevBtn.addEventListener('click', handleVotingPrev);
  document.getElementById('btn-cast-final-vote').addEventListener('click', castSecureBallot);
  const finishBtn = document.getElementById('btn-vote-finish');
  if (finishBtn) {
    finishBtn.addEventListener('click', () => {
      closeModal('vote-success-modal');
      state.currentUser = null;
      window.location.hash = '#login';
    });
  }

  // Generic modal closes
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const backdrop = e.target.closest('.modal-backdrop');
      if (backdrop) backdrop.classList.add('hidden');
    });
  });
}

/**
 * Universal Login Handler
 */
async function handleRoleLogin(e, role) {
  e.preventDefault();
  const alertBox = document.getElementById('login-message');
  alertBox.classList.add('hidden');

  let payload = { role };

  if (role === 'admin') {
    payload.username = document.getElementById('admin-username').value;
    payload.password = document.getElementById('admin-password').value;
  } else if (role === 'principal') {
    payload.school_code = document.getElementById('principal-school-code').value;
    payload.password = document.getElementById('principal-password').value;
  } else if (role === 'teacher') {
    payload.school_code = document.getElementById('teacher-school-code').value;
    payload.username = document.getElementById('teacher-username').value;
    payload.password = document.getElementById('teacher-password').value;
  } else if (role === 'student') {
    const schoolCode = document.getElementById('student-school-code').value;
    const password = document.getElementById('student-voter-id').value;
    const groupContainer = document.getElementById('booth-group-selection-container');
    const selectGroup = document.getElementById('booth-select-group');
    const submitBtn = document.getElementById('btn-booth-submit');

    if (groupContainer.classList.contains('hidden')) {
      // Stage 1: Authenticate and get groups
      try {
        const data = await apiPost('api.php?action=login', {
          role: 'booth',
          school_code: schoolCode,
          password: password,
          group_id: 0
        });
        if (data.success && data.requires_group) {
          if (data.groups.length === 0) {
            throw new Error('No active election groups configured. Please configure groups in the principal dashboard first.');
          }
          selectGroup.innerHTML = data.groups.map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
          groupContainer.classList.remove('hidden');
          submitBtn.textContent = 'Lock & Activate Booth';
        }
      } catch (err) {
        showLoginError(err.message);
      }
      return;
    } else {
      // Stage 2: Lock booth to group
      const groupId = selectGroup.value;
      payload = {
        role: 'booth',
        school_code: schoolCode,
        password: password,
        group_id: groupId
      };
    }
  }

  try {
    const data = await apiPost('api.php?action=login', payload);
    if (data.success) {
      // Clear forms
      e.target.reset();
      if (role === 'student') {
        const boothGroupContainer = document.getElementById('booth-group-selection-container');
        if (boothGroupContainer) boothGroupContainer.classList.add('hidden');
        const boothSubmitBtn = document.getElementById('btn-booth-submit');
        if (boothSubmitBtn) boothSubmitBtn.textContent = 'Setup Booth';
      }
      checkSession();
    }
  } catch (err) {
    showLoginError(err.message);
  }
}

/**
 * Super Admin Panel Controllers
 */
async function loadAdminDashboard() {
  try {
    const schools = await apiGet('api.php?action=admin_get_schools');
    state.schools = schools;
    renderSchoolsTable();
  } catch (err) {
    alert(err.message);
  }
}

function renderSchoolsTable() {
  const tbody = document.getElementById('schools-list-tbody');
  tbody.innerHTML = '';

  if (state.schools.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">No schools registered yet. Click "+ Add New School" to start.</td></tr>`;
    return;
  }

  state.schools.forEach(school => {
    const created = new Date(school.created_at).toLocaleDateString();
    const isLocked = school.days_remaining <= 0;
    const remainingText = isLocked 
      ? `<span class="list-delete-btn" style="border:none;background:none;padding:0;">Expired (Locked)</span>` 
      : `${school.days_remaining} Days`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(school.name)}</strong></td>
      <td><code>${escapeHtml(school.school_code)}</code></td>
      <td>${school.teacher_count} / 5</td>
      <td>${school.student_count}</td>
      <td><span class="badge ${school.election_status === 'started' ? 'badge-active' : 'badge-future'}">${school.election_status}</span></td>
      <td>${created}</td>
      <td>${remainingText}</td>
      <td>
        <button class="list-action-btn list-inspect-btn" onclick="inspectSchool(${school.id})">Inspect</button>
        <button class="list-action-btn list-inspect-btn" style="color:var(--emerald-text); border-color:var(--emerald-border);" onclick="extendSchool(${school.id}, '${escapeQuote(school.name)}')">Extend</button>
        <button class="list-action-btn list-delete-btn" onclick="deleteSchool(${school.id}, '${escapeQuote(school.name)}')">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function inspectSchool(schoolId) {
  try {
    const data = await apiGet(`api.php?action=admin_get_school_data&school_id=${schoolId}`);
    state.inspectSchool = data;

    document.getElementById('inspect-school-name').textContent = data.school.name;
    document.getElementById('inspect-total-students').textContent = data.stats.total_students;
    document.getElementById('inspect-voted-students').textContent = data.stats.voted_students;
    
    const turnout = data.stats.total_students > 0 
      ? Math.round((data.stats.voted_students / data.stats.total_students) * 100) 
      : 0;
    document.getElementById('inspect-turnout').textContent = `${turnout}%`;
    document.getElementById('inspect-days-remaining').textContent = data.days_remaining <= 0 ? 'Locked (Expired)' : `${data.days_remaining} Days`;

    // Render Teachers
    const tBody = document.getElementById('inspect-teachers-tbody');
    tBody.innerHTML = data.teachers.length === 0 
      ? `<tr><td class="text-muted">No teachers registered</td></tr>` 
      : data.teachers.map(t => `<tr><td>${escapeHtml(t.username)}</td></tr>`).join('');

    // Render Groups
    const gBody = document.getElementById('inspect-groups-tbody');
    gBody.innerHTML = data.groups.length === 0 
      ? `<tr><td colspan="3" class="text-muted">No groups configuration</td></tr>` 
      : data.groups.map(g => `
          <tr>
            <td><strong>${escapeHtml(g.name)}</strong></td>
            <td><code>${g.type}</code></td>
            <td>${g.is_visible ? 'Visible' : 'Hidden'}</td>
          </tr>
        `).join('');

    // Render Candidates
    const cBody = document.getElementById('inspect-candidates-tbody');
    cBody.innerHTML = data.candidates.length === 0 
      ? `<tr><td colspan="5" class="text-muted text-center">No standing candidates</td></tr>` 
      : data.candidates.map(c => `
          <tr>
            <td><strong>${escapeHtml(c.name)}</strong></td>
            <td><code>${c.gender}</code></td>
            <td>${escapeHtml(c.group_name)}</td>
            <td>${escapeHtml(c.party_name || '-')}</td>
            <td><div class="symbol-preview-avatar" style="width:28px;height:28px;font-size:0.9rem;">${renderSymbolHtml(c.party_symbol)}</div></td>
          </tr>
        `).join('');

    openModal('inspect-school-modal');
  } catch (err) {
    alert(err.message);
  }
}

async function deleteSchool(schoolId, name) {
  if (confirm(`Are you absolutely sure you want to delete "${name}"? All associated teachers, students, candidates, and election records will be permanently deleted.`)) {
    try {
      await apiPost('api.php?action=admin_delete_school', { school_id: schoolId });
      loadAdminDashboard();
    } catch (err) {
      alert(err.message);
    }
  }
}

async function extendSchool(schoolId, name) {
  const daysText = prompt(`Enter the number of days to extend the trial/access period for "${name}":`, "30");
  if (daysText === null) return; // Cancelled
  
  const days = parseInt(daysText, 10);
  if (isNaN(days) || days <= 0) {
    alert("Please enter a valid positive number of days.");
    return;
  }

  try {
    const res = await apiPost('api.php?action=admin_extend_school', { school_id: schoolId, days: days });
    alert(res.message);
    loadAdminDashboard();
  } catch (err) {
    alert(err.message);
  }
}

/**
 * Principal Dashboard Controller
 */
async function loadPrincipalDashboard() {
  try {
    const data = await apiGet('api.php?action=principal_get_dashboard');
    state.groups = data.groups;
    state.teachers = data.teachers;

    // Display basic stats
    document.getElementById('p-stat-total').textContent = data.stats.total_students;
    document.getElementById('p-stat-voted').textContent = data.stats.voted_students;
    
    const turnout = data.stats.total_students > 0 
      ? Math.round((data.stats.voted_students / data.stats.total_students) * 100) 
      : 0;
    document.getElementById('p-stat-turnout').textContent = `${turnout}%`;
    document.getElementById('p-stat-status').textContent = state.currentUser.school.election_status.toUpperCase();

    // Expire days remaining warning
    const days = state.currentUser.days_remaining;
    const warning = document.getElementById('principal-expiry-warning');
    warning.textContent = `Portal Trial: ${days} Days Remaining`;
    if (days <= 5) {
      warning.className = 'header-tag alert-tag';
    } else {
      warning.className = 'header-tag';
    }

    renderPrincipalTeachers();
    renderPrincipalGroups();
    loadPrincipalResultsAndCharts(turnout);
  } catch (err) {
    alert(err.message);
  }
}

function renderPrincipalTeachers() {
  const list = document.getElementById('teachers-flat-list');
  list.innerHTML = '';

  const limitMsg = document.getElementById('teacher-limit-msg');
  if (state.teachers.length >= 5) {
    limitMsg.classList.remove('hidden');
    document.getElementById('add-teacher-form').querySelector('button').disabled = true;
  } else {
    limitMsg.classList.add('hidden');
    document.getElementById('add-teacher-form').querySelector('button').disabled = false;
  }

  if (state.teachers.length === 0) {
    list.innerHTML = `<li class="text-muted">No teacher accounts created yet.</li>`;
    return;
  }

  state.teachers.forEach(t => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span><strong>${escapeHtml(t.username)}</strong></span>
      <div>
        <button class="list-action-btn list-inspect-btn" onclick="openChangeTeacherPass(${t.id}, '${escapeQuote(t.username)}')">Pass</button>
        <button class="list-action-btn list-delete-btn" onclick="deleteTeacher(${t.id})">Delete</button>
      </div>
    `;
    list.appendChild(li);
  });
}

function openChangeTeacherPass(id, username) {
  document.getElementById('change-pass-teacher-id').value = id;
  document.getElementById('change-pass-teacher-username').textContent = username;
  document.getElementById('change-pass-teacher-newpwd').value = '';
  openModal('change-teacher-pass-modal');
}

async function deleteTeacher(id) {
  if (confirm('Are you sure you want to delete this teacher account?')) {
    try {
      await apiPost('api.php?action=principal_delete_teacher', { teacher_id: id });
      loadPrincipalDashboard();
    } catch (err) {
      alert(err.message);
    }
  }
}

function renderPrincipalGroups() {
  const container = document.getElementById('principal-groups-container');
  container.innerHTML = '';

  state.groups.forEach(g => {
    const card = document.createElement('div');
    card.className = 'group-setup-card';
    
    // Check if group is custom so principal can delete it. Or let principal delete any group.
    // Default 6 groups: Red House, Blue House, Green House, Yellow House, Head Boy & Girl, Sports Captain.
    const defaultGroupNames = ['red house', 'blue house', 'green house', 'yellow house', 'head boy & girl', 'sports captain'];
    const isDefault = defaultGroupNames.includes(g.name.toLowerCase());
    
    const deleteBtn = isDefault 
      ? '' 
      : `<button class="list-action-btn list-delete-btn" onclick="deleteGroup(${g.id})">Delete</button>`;

    card.innerHTML = `
      <div>
        <span class="group-card-type">${g.type} group</span>
        <h3 class="group-card-title">${escapeHtml(g.name)}</h3>
      </div>
      <div class="group-card-actions">
        <label class="visibility-checkbox-container">
          <input type="checkbox" ${g.is_visible ? 'checked' : ''} onchange="toggleGroupVisibility(${g.id}, this.checked)">
          Visible to students
        </label>
        ${deleteBtn}
      </div>
    `;
    container.appendChild(card);
  });
}

async function toggleGroupVisibility(groupId, isChecked) {
  try {
    await apiPost('api.php?action=principal_set_group_visibility', {
      group_id: groupId,
      is_visible: isChecked ? 1 : 0
    });
  } catch (err) {
    alert(err.message);
  }
}

async function deleteGroup(groupId) {
  if (confirm('Are you sure you want to delete this custom group? Candidates assigned to this group will lose their group association.')) {
    try {
      await apiPost('api.php?action=principal_delete_group', { group_id: groupId });
      loadPrincipalDashboard();
    } catch (err) {
      alert(err.message);
    }
  }
}

async function updateElectionStatus(status) {
  try {
    const data = await apiPost('api.php?action=principal_set_election_status', { status });
    alert(data.message);
    state.currentUser.school.election_status = status;
    loadPrincipalDashboard();
  } catch (err) {
    alert(err.message);
  }
}

async function loadPrincipalResultsAndCharts(turnoutVal) {
  try {
    const data = await apiGet('api.php?action=principal_get_results');
    
    // Draw voter turnout chart
    renderTurnoutPieChart(turnoutVal);

    // Render detailed results table
    const tbody = document.getElementById('principal-results-tbody');
    tbody.innerHTML = '';

    if (data.candidates.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No candidates are registered yet.</td></tr>`;
      return;
    }

    data.candidates.forEach(c => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHtml(c.name)}</strong></td>
        <td><code>${c.gender}</code></td>
        <td>${escapeHtml(c.group_name)}</td>
        <td>${escapeHtml(c.party_name || '-')}</td>
        <td><div class="symbol-preview-avatar" style="width:30px;height:30px;font-size:0.9rem;">${renderSymbolHtml(c.party_symbol)}</div></td>
        <td><strong>${c.vote_count}</strong> votes</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to load results:', err);
  }
}

function renderTurnoutPieChart(votedPercent) {
  const ctx = document.getElementById('turnout-chart').getContext('2d');

  if (state.turnoutChart) {
    state.turnoutChart.destroy();
  }

  state.turnoutChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Votes Casted (%)', 'Remaining Voters (%)'],
      datasets: [{
        data: [votedPercent, 100 - votedPercent],
        backgroundColor: ['rgba(59, 130, 246, 0.7)', 'rgba(255, 255, 255, 0.05)'],
        borderColor: ['#3b82f6', 'rgba(255, 255, 255, 0.1)'],
        borderWidth: 1.5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { color: '#cbd5e1', font: { family: 'Plus Jakarta Sans', weight: 'bold' } }
        }
      }
    }
  });
}

/**
 * Teacher Dashboard Controller
 */
async function loadTeacherDashboard() {
  try {
    const data = await apiGet('api.php?action=teacher_get_students');
    state.students = data.students;
    state.groups = data.groups;

    // Populate group filters
    const filterSelect = document.getElementById('roster-filter-group');
    const studentFormGroupSelect = document.getElementById('edit-student-group');
    
    // Save current values to prevent overwrite jumps
    const currentFilter = filterSelect.value;
    
    filterSelect.innerHTML = `<option value="all">All Groups</option>`;
    studentFormGroupSelect.innerHTML = ``;

    state.groups.forEach(g => {
      filterSelect.innerHTML += `<option value="${g.id}">${escapeHtml(g.name)}</option>`;
      studentFormGroupSelect.innerHTML += `<option value="${g.id}">${escapeHtml(g.name)}</option>`;
    });

    filterSelect.value = currentFilter;

    renderStudentsTable();
  } catch (err) {
    alert(err.message);
  }
}

function renderStudentsTable() {
  const tbody = document.getElementById('student-roster-tbody');
  tbody.innerHTML = '';

  const searchVal = document.getElementById('roster-search').value.toLowerCase().trim();
  const groupVal = document.getElementById('roster-filter-group').value;

  const filtered = state.students.filter(s => {
    const matchesSearch = s.name.toLowerCase().includes(searchVal) || s.student_code.toLowerCase().includes(searchVal);
    const matchesGroup = (groupVal === 'all') || (s.group_id == groupVal);
    return matchesSearch && matchesGroup;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">No students found in your filters. Upload template or add manually.</td></tr>`;
    return;
  }

  filtered.forEach(s => {
    const tr = document.createElement('tr');
    
    const candidateText = s.is_candidate == 1 
      ? `<span class="badge badge-active" style="font-size:0.65rem;">Candidate</span>` 
      : `<span class="badge badge-future" style="font-size:0.65rem;">Voter</span>`;

    const partyInfo = s.is_candidate == 1 
      ? `<div style="display:flex;align-items:center;gap:6px;">
           <span style="font-size:1.1rem;">${renderSymbolHtml(s.party_symbol)}</span>
           <span>${escapeHtml(s.party_name || '-')}</span>
         </div>`
      : '-';

    tr.innerHTML = `
      <td><code>${escapeHtml(s.student_code)}</code></td>
      <td><strong>${escapeHtml(s.name)}</strong></td>
      <td><code>${s.gender}</code></td>
      <td>${escapeHtml(s.group_name)}</td>
      <td>${s.has_voted == 1 ? '✓ Yes' : 'No'}</td>
      <td>${candidateText}</td>
      <td>${partyInfo}</td>
      <td>
        <button class="list-action-btn list-inspect-btn" onclick="openEditStudent(${s.id})">Edit</button>
        <button class="list-action-btn list-delete-btn" onclick="deleteStudent(${s.id})">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function filterStudentsTable() {
  renderStudentsTable();
}

function openEditStudent(id) {
  const student = state.students.find(s => s.id == id);
  if (!student) return;

  document.getElementById('student-modal-title').textContent = 'Edit Candidate Record';
  document.getElementById('edit-student-id').value = student.id;
  document.getElementById('edit-student-code').value = student.student_code;
  document.getElementById('edit-student-name').value = student.name;
  document.getElementById('edit-student-gender').value = student.gender;
  document.getElementById('edit-student-group').value = student.group_id;

  const isCandidate = true; // In this flow everyone is a candidate
  const studentCandidateCheckbox = document.getElementById('edit-student-candidate');
  if (studentCandidateCheckbox) studentCandidateCheckbox.checked = isCandidate;

  const subpanel = document.getElementById('candidate-details-subpanel');
  if (subpanel) {
    subpanel.classList.remove('hidden');
    document.getElementById('edit-candidate-party').value = student.party_name || '';
    
    const symbol = student.party_symbol || '🌟';
    document.getElementById('edit-candidate-symbol-path').value = symbol;

    // Set emoji select if standard emoji, else custom image
    const cleanSymbol = symbol.trim();
    const isImage = cleanSymbol.startsWith('uploads/') || 
                    cleanSymbol.startsWith('http://') || 
                    cleanSymbol.startsWith('https://') || 
                    cleanSymbol.startsWith('data:image/') ||
                    /\.(png|jpe?g|gif|svg|webp)$/i.test(cleanSymbol);
    if (isImage) {
      let src = cleanSymbol;
      if (!cleanSymbol.startsWith('uploads/') && !cleanSymbol.startsWith('http://') && !cleanSymbol.startsWith('https://') && !cleanSymbol.startsWith('data:image/')) {
        src = 'uploads/' + cleanSymbol;
      }
      document.getElementById('party-symbol-preview').innerHTML = `<img src="${src}" alt="symbol">`;
    } else {
      document.getElementById('edit-candidate-symbol-emoji').value = symbol;
      document.getElementById('party-symbol-preview').innerHTML = symbol;
    }

    // Load candidate photo
    const photoPath = student.candidate_photo || '';
    const photoPreview = document.getElementById('candidate-photo-preview');
    const clearPhotoBtn = document.getElementById('btn-clear-candidate-photo');
    document.getElementById('edit-candidate-photo-path').value = photoPath;
    document.getElementById('edit-candidate-photo-file').value = '';
    document.getElementById('photo-upload-status').style.display = 'none';
    if (photoPath) {
      photoPreview.innerHTML = `<img src="${photoPath}" alt="Candidate Photo">`;
      if (clearPhotoBtn) clearPhotoBtn.style.display = 'inline-flex';
    } else {
      photoPreview.innerHTML = `<span class="photo-placeholder-icon">👤</span><span class="photo-placeholder-text">No photo</span>`;
      if (clearPhotoBtn) clearPhotoBtn.style.display = 'none';
    }
  }

  openModal('student-form-modal');
}

async function deleteStudent(id) {
  if (confirm('Are you sure you want to delete this student record?')) {
    try {
      await apiPost('api.php?action=teacher_delete_student', { id });
      loadTeacherDashboard();
    } catch (err) {
      alert(err.message);
    }
  }
}

/**
 * Excel Integration (SheetJS)
 */
function handleExcelImport(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      
      const formatted = [];
      workbook.SheetNames.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet);
        if (rows.length === 0) return;
        
        rows.forEach(r => {
          // Find keys case-insensitively
          const findVal = (listKeys) => {
            const matchedKey = Object.keys(r).find(k => listKeys.includes(k.toLowerCase().replace(/[\s_-]/g, '')));
            return matchedKey ? r[matchedKey] : null;
          };
          
          const name = findVal(['name', 'fullname', 'candidatename', 'studentname']);
          const gender = findVal(['gender', 'sex']);
          if (name) {
            formatted.push({
              student_code: findVal(['studentcode', 'rollnumber', 'rollno', 'id', 'student_code']) || '',
              name: name,
              gender: gender ? gender.toLowerCase().trim() : 'boy',
              group_name: sheetName, // The sheet name represents the group name
              is_candidate: 1,
              party_name: findVal(['partyname', 'party']) || '',
              party_symbol: findVal(['partysymbol', 'symbol']) || ''
            });
          }
        });
      });

      if (formatted.length === 0) {
        alert('Invalid spreadsheet layout. Please ensure your Excel sheets contain Name and Gender columns.');
        return;
      }

      const res = await apiPost('api.php?action=teacher_upsert_students', { students: formatted });
      alert(res.message);
      loadTeacherDashboard();
    } catch (err) {
      alert('Failed to parse Excel: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function exportStudentsToExcel() {
  if (state.students.length === 0) {
    alert('No student data to export.');
    return;
  }

  const exportData = state.students.map(s => ({
    'Student ID (Roll No)': s.student_code,
    'Full Name': s.name,
    'Gender': s.gender.toUpperCase(),
    'Election Group / House': s.group_name,
    'Voted?': s.has_voted == 1 ? 'YES' : 'NO',
    'Standing Candidate?': s.is_candidate == 1 ? 'YES' : 'NO',
    'Party Name': s.party_name || '',
    'Party Symbol (Emoji/Path)': s.party_symbol || ''
  }));

  const worksheet = XLSX.utils.json_to_sheet(exportData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Students Roster');

  // Generate Excel file trigger
  XLSX.writeFile(workbook, `DemocraSchools_Roster_${state.currentUser.school.school_code}.xlsx`);
}

function downloadExcelTemplate() {
  const workbook = XLSX.utils.book_new();
  
  const redHouseData = [
    { 'Name': 'John Doe', 'Gender': 'boy', 'Party Name': 'Victory Stars', 'Party Symbol': 'star.png' },
    { 'Name': 'Sarah Smith', 'Gender': 'girl', 'Party Name': 'Victory Stars', 'Party Symbol': 'star.png' }
  ];
  const blueHouseData = [
    { 'Name': 'David Miller', 'Gender': 'boy', 'Party Name': 'Future Pioneers', 'Party Symbol': 'rocket.jpg' },
    { 'Name': 'Emma Davis', 'Gender': 'girl', 'Party Name': 'Future Pioneers', 'Party Symbol': 'rocket.jpg' }
  ];
  const headPositionData = [
    { 'Name': 'Robert Johnson', 'Gender': 'boy', 'Party Name': 'Democratic Youth', 'Party Symbol': 'lion.png' },
    { 'Name': 'Patricia Brown', 'Gender': 'girl', 'Party Name': 'Democratic Youth', 'Party Symbol': 'lion.png' }
  ];
  
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(redHouseData), 'Red House');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(blueHouseData), 'Blue House');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(headPositionData), 'Head Position');
  
  XLSX.writeFile(workbook, 'DemocraSchools_Candidates_Template.xlsx');
}

/**
 * Teacher Mock Sandbox rendering
 */
function openMockSandbox() {
  // Populate select dropdown
  const groupSelect = document.getElementById('sandbox-select-group');
  groupSelect.innerHTML = '';
  
  state.groups.forEach(g => {
    groupSelect.innerHTML += `<option value="${g.id}">${escapeHtml(g.name)}</option>`;
  });

  renderSandboxCandidates();
  openModal('mock-sandbox-modal');
}

function renderSandboxCandidates() {
  const groupId = document.getElementById('sandbox-select-group').value;
  const boysGrid = document.getElementById('sandbox-boys-grid');
  const girlsGrid = document.getElementById('sandbox-girls-grid');

  boysGrid.innerHTML = '';
  girlsGrid.innerHTML = '';

  const groupCandidates = state.students.filter(s => s.group_id == groupId && s.is_candidate == 1);
  const boys = groupCandidates.filter(c => c.gender === 'boy');
  const girls = groupCandidates.filter(c => c.gender === 'girl');

  const createCard = (c) => {
    const photoHtml = c.candidate_photo
      ? `<div class="candidate-tile-photo"><img src="${c.candidate_photo}" alt="${escapeHtml(c.name)}"></div>`
      : `<div class="candidate-tile-photo placeholder"><span>👤</span></div>`;
    return `
    <div class="candidate-tile-card">
      ${photoHtml}
      <div class="candidate-tile-symbol">
        ${renderSymbolHtml(c.party_symbol)}
      </div>
      <span class="candidate-tile-name">${escapeHtml(c.name)}</span>
      <span class="candidate-tile-party">${escapeHtml(c.party_name || 'Independent')}</span>
    </div>
  `;
  };

  boysGrid.innerHTML = boys.length === 0 
    ? `<span class="text-muted text-center col-span-2">No boys registered for this group.</span>`
    : boys.map(createCard).join('');

  girlsGrid.innerHTML = girls.length === 0 
    ? `<span class="text-muted text-center col-span-2">No girls registered for this group.</span>`
    : girls.map(createCard).join('');
}

/**
 * Student Voting Portal Core Wizard
 */
function playChime() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.15); // A5
    gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.6);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.6);
  } catch (e) {
    console.error('AudioContext chime failed:', e);
  }
}

function speakThankYou() {
  try {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel(); // Cancel any ongoing speech
      const utterance = new SpeechSynthesisUtterance("Thank you for voting!");
      utterance.rate = 1.0;
      utterance.pitch = 1.1;
      window.speechSynthesis.speak(utterance);
    }
  } catch (e) {
    console.error('SpeechSynthesis failed:', e);
  }
}

/**
 * Student Voting Portal Core Wizard (Booth Locked Group Flow)
 */
async function loadStudentVotingPortal() {
  try {
    const data = await apiGet('api.php?action=student_get_election_info');
    state.electionInfo = data;

    if (!data.group) {
      alert('Error: This booth is not assigned to any active election group.');
      window.location.hash = '#login';
      return;
    }

    // Resolve active voting groups for this booth (only 1 locked group)
    state.activeGroups = [data.group];

    // Set voter welcome headers
    const schoolName = (state.currentUser && state.currentUser.school) ? state.currentUser.school.name : 'School Election';
    const groupName = (state.currentUser && state.currentUser.group_name) ? state.currentUser.group_name : 'Voting Booth';
    document.getElementById('voter-welcome-name').textContent = schoolName;
    document.getElementById('voter-welcome-info').textContent = `Active Booth: ${groupName}`;

    // Reset wizard steps
    state.votingStep = 0;
    state.votingSelections = {};
    
    // Initialize selections map
    state.votingSelections[data.group.id] = { boy: null, girl: null };

    renderVotingStep();
  } catch (err) {
    alert(err.message);
    window.location.hash = '#login';
  }
}

function renderVotingStep() {
  const currentGroup = state.activeGroups[state.votingStep];
  if (!currentGroup) return;

  // Title displays
  document.getElementById('voting-step-indicator').textContent = 'Active Booth';
  
  // Progress bar is removed, check if element exists before style access
  const progressFill = document.getElementById('voting-progress-fill');
  if (progressFill) {
    progressFill.style.width = '100%';
  }

  document.getElementById('ballot-group-heading').textContent = currentGroup.name;
  document.getElementById('ballot-group-subheading').textContent = `Select 1 boy candidate and 1 girl candidate from the list below.`;

  // Render Candidates Column
  const boysContainer = document.getElementById('ballot-boys-container');
  const girlsContainer = document.getElementById('ballot-girls-container');

  boysContainer.innerHTML = '';
  girlsContainer.innerHTML = '';

  const candidates = state.electionInfo.candidates.filter(c => c.group_id == currentGroup.id);
  const boys = candidates.filter(c => c.gender === 'boy');
  const girls = candidates.filter(c => c.gender === 'girl');

  const createVoteRow = (c, genderType) => {
    const isSelected = state.votingSelections[currentGroup.id][genderType] == c.id;
    const row = document.createElement('div');
    row.className = `candidate-vote-row ${isSelected ? 'selected' : ''}`;
    const photoHtml = c.candidate_photo
      ? `<div class="vote-row-photo"><img src="${c.candidate_photo}" alt="${escapeHtml(c.name)}"></div>`
      : `<div class="vote-row-photo placeholder"><span>👤</span></div>`;
    row.innerHTML = `
      ${photoHtml}
      <div class="vote-row-symbol">${renderSymbolHtml(c.party_symbol)}</div>
      <div class="vote-row-info">
        <h4 class="vote-row-name">${escapeHtml(c.name)}</h4>
        <span class="vote-row-party">${escapeHtml(c.party_name || 'Independent')}</span>
      </div>
      <div class="vote-checkbox">${isSelected ? '✓' : ''}</div>
    `;

    row.addEventListener('click', () => {
      const currentSelection = state.votingSelections[currentGroup.id][genderType];
      if (currentSelection == c.id) {
        // Deselect
        state.votingSelections[currentGroup.id][genderType] = null;
      } else {
        // Select
        state.votingSelections[currentGroup.id][genderType] = c.id;
      }
      renderVotingStep(); // Re-render this step
    });

    return row;
  };

  if (boys.length === 0) {
    boysContainer.innerHTML = `<p class="text-muted">No candidates standing.</p>`;
  } else {
    boys.forEach(b => boysContainer.appendChild(createVoteRow(b, 'boy')));
  }

  if (girls.length === 0) {
    girlsContainer.innerHTML = `<p class="text-muted">No candidates standing.</p>`;
  } else {
    girls.forEach(g => girlsContainer.appendChild(createVoteRow(g, 'girl')));
  }

  // Update button layouts
  const prevBtn = document.getElementById('btn-ballot-prev');
  if (prevBtn) {
    if (state.votingStep === 0) {
      prevBtn.disabled = true;
      prevBtn.className = 'launch-btn disabled-btn';
    } else {
      prevBtn.disabled = false;
      prevBtn.className = 'launch-btn';
    }
  }

  const nextBtn = document.getElementById('btn-ballot-next');
  if (nextBtn) {
    if (state.votingStep === state.activeGroups.length - 1) {
      nextBtn.textContent = 'Review & Cast Ballot';
    } else {
      nextBtn.textContent = 'Next Section';
    }
  }
}

function handleVotingNext() {
  if (state.votingStep < state.activeGroups.length - 1) {
    state.votingStep++;
    renderVotingStep();
  } else {
    // Show summary modal
    openBallotSummaryModal();
  }
}

function handleVotingPrev() {
  if (state.votingStep > 0) {
    state.votingStep--;
    renderVotingStep();
  }
}

function openBallotSummaryModal() {
  const container = document.getElementById('ballot-summary-container');
  container.innerHTML = '';

  state.activeGroups.forEach(g => {
    const selection = state.votingSelections[g.id];
    
    // Find candidate names
    const getCandidateName = (id) => {
      if (!id) return null;
      const c = state.electionInfo.candidates.find(item => item.id == id);
      return c ? `${c.name} (${c.party_name || 'Independent'})` : null;
    };

    const boyName = getCandidateName(selection.boy);
    const girlName = getCandidateName(selection.girl);

    const row = document.createElement('div');
    row.className = 'summary-row';
    row.innerHTML = `
      <div>
        <span class="summary-group-title">${escapeHtml(g.name)}</span>
        <div class="margin-top-10">
          <div class="summary-choice-desc ${!boyName ? 'no-vote' : ''}">Boy: ${boyName || 'No selection (Abstained)'}</div>
          <div class="summary-choice-desc ${!girlName ? 'no-vote' : ''}">Girl: ${girlName || 'No selection (Abstained)'}</div>
        </div>
      </div>
    `;
    container.appendChild(row);
  });

  // Ensure anim elements reset
  document.getElementById('ballot-drop-box').classList.add('hidden');
  document.getElementById('ballot-paper-anim').classList.remove('cast-animation');
  document.getElementById('summary-buttons-row').classList.remove('hidden');

  openModal('vote-summary-modal');
}

async function castSecureBallot() {
  const finalVotes = [];
  
  // Extract all non-null candidate IDs
  Object.values(state.votingSelections).forEach(sel => {
    if (sel.boy) finalVotes.push(sel.boy);
    if (sel.girl) finalVotes.push(sel.girl);
  });

  if (finalVotes.length === 0) {
    if (!confirm('You have not selected any candidates (abstaining from all categories). Do you still want to cast your ballot?')) {
      return;
    }
  }

  // Visual Ballot paper drop effect
  const buttonsRow = document.getElementById('summary-buttons-row');
  const animContainer = document.getElementById('ballot-drop-box');
  const paper = document.getElementById('ballot-paper-anim');

  buttonsRow.classList.add('hidden');
  animContainer.classList.remove('hidden');
  
  // Add animation class
  setTimeout(() => {
    paper.classList.add('cast-animation');
  }, 100);

  // Submit to API after animation completes (approx 800ms)
  setTimeout(async () => {
    try {
      await apiPost('api.php?action=student_cast_vote', { votes: finalVotes });
      
      closeModal('vote-summary-modal');
      openModal('vote-success-modal');
      
      // Explosion confetti effects!
      triggerConfetti();

      // Play audio engine sounds
      playChime();
      speakThankYou();

      // ─── PHASE 1: Thank You countdown (5 seconds) ─────────────────────────
      const phaseThankYou = document.getElementById('handoff-phase-thankyou');
      const phaseNext     = document.getElementById('handoff-phase-next');
      const countdownNum  = document.getElementById('handoff-countdown-num');
      const svgCircle     = document.getElementById('handoff-svg-circle');

      // SVG ring setup: circumference = 2 * π * r = 2 * π * 44 ≈ 276.5
      const CIRC = 2 * Math.PI * 44;
      if (svgCircle) {
        svgCircle.style.strokeDasharray  = CIRC;
        svgCircle.style.strokeDashoffset = 0;
      }

      phaseThankYou.classList.remove('hidden');
      phaseNext.classList.add('hidden');

      let secondsLeft = 5;
      if (countdownNum) countdownNum.textContent = secondsLeft;

      const handoffInterval = setInterval(() => {
        secondsLeft--;
        if (countdownNum) countdownNum.textContent = secondsLeft;

        // Animate SVG ring depleting
        if (svgCircle) {
          const offset = CIRC * (1 - secondsLeft / 5);
          svgCircle.style.strokeDashoffset = offset;
        }

        if (secondsLeft <= 0) {
          clearInterval(handoffInterval);

          // ─── PHASE 2: Next Voter screen ─────────────────────────────────
          phaseThankYou.classList.add('hidden');
          phaseNext.classList.remove('hidden');

          // Second confetti burst welcoming next voter
          setTimeout(() => triggerConfetti(), 300);
        }
      }, 1000);

    } catch (err) {
      alert(err.message);
      buttonsRow.classList.remove('hidden');
      animContainer.classList.add('hidden');
    }
  }, 900);
}

// "Start Voting" button on the Next Voter handoff screen resets the booth
document.addEventListener('DOMContentLoaded', () => {
  const startNextBtn = document.getElementById('btn-handoff-start-next');
  if (startNextBtn) {
    startNextBtn.addEventListener('click', () => {
      closeModal('vote-success-modal');

      // Reset phase states for next use
      const phaseThankYou = document.getElementById('handoff-phase-thankyou');
      const phaseNext     = document.getElementById('handoff-phase-next');
      if (phaseThankYou) phaseThankYou.classList.remove('hidden');
      if (phaseNext)     phaseNext.classList.add('hidden');

      // Reset SVG ring
      const svgCircle = document.getElementById('handoff-svg-circle');
      if (svgCircle) {
        const CIRC = 2 * Math.PI * 44;
        svgCircle.style.strokeDashoffset = 0;
      }

      // Clear selections and reload voting booth
      state.votingSelections = {};
      loadStudentVotingPortal();
    });
  }
});


function triggerConfetti() {
  if (typeof confetti === 'function') {
    confetti({
      particleCount: 150,
      spread: 70,
      origin: { y: 0.6 }
    });
  }
}

/**
 * Generic Modal Actions
 */
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

/**
 * Text Sanitizers & Helpers
 */
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeQuote(text) {
  if (!text) return '';
  return text.replace(/'/g, "\\'");
}

function renderSymbolHtml(symbol) {
  if (!symbol) return '🌟';
  const clean = symbol.trim();
  const isImage = clean.startsWith('uploads/') || 
                  clean.startsWith('symbols/') ||
                  clean.startsWith('http://') || 
                  clean.startsWith('https://') || 
                  clean.startsWith('data:image/') ||
                  /\.(png|jpe?g|gif|svg|webp)$/i.test(clean);
  if (isImage) {
    return `<img src="${clean}" alt="symbol" style="width:100%;height:100%;object-fit:cover;">`;
  }
  return symbol; // Returns Emoji characters directly
}
