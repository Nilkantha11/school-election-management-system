<?php
/**
 * School Election Management System - Unified API Engine
 * Handles authentication, data retrieval, uploads, and modifications.
 */

session_start();

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

// 1. Verify Database Configuration
$config_file = __DIR__ . '/db_config.php';
if (!file_exists($config_file)) {
    http_response_code(503);
    echo json_encode(['configured' => false, 'error' => 'System is not configured yet. Run installer first.']);
    exit;
}

require_once $config_file;

// Initialize Database Connection
try {
    $pdo = new PDO("mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4", DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
    ]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Database connection failed: ' . $e->getMessage()]);
    exit;
}

// Ensure uploads folder exists
if (!file_exists(__DIR__ . '/uploads')) {
    mkdir(__DIR__ . '/uploads', 0755, true);
}

// 2. Helper Functions

// Check if a school is locked (after 30 days of creation)
function getSchoolRemainingDays($school_id) {
    global $pdo;
    $stmt = $pdo->prepare("SELECT created_at FROM schools WHERE id = ?");
    $stmt->execute([$school_id]);
    $school = $stmt->fetch();
    if (!$school) return 0;
    
    $created = strtotime($school['created_at']);
    $now = time();
    $diff_seconds = $now - $created;
    $days_elapsed = $diff_seconds / (60 * 60 * 24);
    $days_remaining = max(0, 30 - floor($days_elapsed));
    return $days_remaining;
}

function isSchoolLocked($school_id) {
    // If user is super admin, never lock them out
    if (isset($_SESSION['role']) && $_SESSION['role'] === 'admin') {
        return false;
    }
    return getSchoolRemainingDays($school_id) <= 0;
}

// Retrieve input data
$action = isset($_GET['action']) ? $_GET['action'] : '';
$raw_input = file_get_contents('php://input');
$input = json_decode($raw_input, true) ?: [];

// Get logged-in user context
$user_role = isset($_SESSION['role']) ? $_SESSION['role'] : null;
$school_id = isset($_SESSION['school_id']) ? $_SESSION['school_id'] : null;

// Auth check middlewares
function requireRole($allowed_roles) {
    global $user_role;
    if (!$user_role || !in_array($user_role, $allowed_roles)) {
        http_response_code(401);
        echo json_encode(['error' => 'Unauthorized access. Role: ' . ($user_role ?: 'Guest')]);
        exit;
    }
}

function requireNotLocked() {
    global $school_id;
    if ($school_id && isSchoolLocked($school_id)) {
        http_response_code(403);
        echo json_encode(['error' => 'This school account is locked. The 30-day active period has expired.']);
        exit;
    }
}

// 3. API Actions Routing

switch ($action) {

    case 'check_session':
        if ($user_role) {
            $response = [
                'logged_in' => true,
                'role' => $user_role,
                'username' => isset($_SESSION['username']) ? $_SESSION['username'] : '',
                'school_id' => $school_id,
            ];
            if ($school_id) {
                $stmt = $pdo->prepare("SELECT name, school_code, election_status, show_head, show_sport FROM schools WHERE id = ?");
                $stmt->execute([$school_id]);
                $response['school'] = $stmt->fetch();
                $response['days_remaining'] = getSchoolRemainingDays($school_id);
                $response['is_locked'] = $response['days_remaining'] <= 0;
            }
            echo json_encode($response);
        } else {
            echo json_encode(['logged_in' => false]);
        }
        break;

    case 'login':
        $role = isset($input['role']) ? $input['role'] : '';
        
        if ($role === 'admin') {
            $username = isset($input['username']) ? $input['username'] : '';
            $password = isset($input['password']) ? $input['password'] : '';
            
            $stmt = $pdo->prepare("SELECT * FROM admin WHERE username = ?");
            $stmt->execute([$username]);
            $admin = $stmt->fetch();
            
            if ($admin && password_verify($password, $admin['password_hash'])) {
                $_SESSION['role'] = 'admin';
                $_SESSION['username'] = $username;
                $_SESSION['school_id'] = null;
                echo json_encode(['success' => true, 'role' => 'admin']);
            } else {
                http_response_code(401);
                echo json_encode(['success' => false, 'error' => 'Invalid admin credentials.']);
            }
        } 
        else if ($role === 'principal') {
            $school_code = isset($input['school_code']) ? $input['school_code'] : '';
            $password = isset($input['password']) ? $input['password'] : '';
            
            $stmt = $pdo->prepare("SELECT * FROM schools WHERE school_code = ?");
            $stmt->execute([$school_code]);
            $school = $stmt->fetch();
            
            if ($school) {
                // Check lock first before password verify to show specific lockout warning if desired,
                // but standard requires checking password. Let's do both.
                if (password_verify($password, $school['principal_password_hash'])) {
                    $days = getSchoolRemainingDays($school['id']);
                    if ($days <= 0) {
                        http_response_code(403);
                        echo json_encode(['success' => false, 'error' => 'This school portal has locked (30-day limit reached). Please contact Admin.']);
                    } else {
                        $_SESSION['role'] = 'principal';
                        $_SESSION['username'] = 'Principal';
                        $_SESSION['school_id'] = $school['id'];
                        echo json_encode(['success' => true, 'role' => 'principal']);
                    }
                } else {
                    http_response_code(401);
                    echo json_encode(['success' => false, 'error' => 'Invalid principal credentials.']);
                }
            } else {
                http_response_code(404);
                echo json_encode(['success' => false, 'error' => 'School code not found.']);
            }
        } 
        else if ($role === 'teacher') {
            $school_code = isset($input['school_code']) ? $input['school_code'] : '';
            $username = isset($input['username']) ? $input['username'] : '';
            $password = isset($input['password']) ? $input['password'] : '';
            
            $stmt = $pdo->prepare("SELECT * FROM schools WHERE school_code = ?");
            $stmt->execute([$school_code]);
            $school = $stmt->fetch();
            
            if ($school) {
                $days = getSchoolRemainingDays($school['id']);
                if ($days <= 0) {
                    http_response_code(403);
                    echo json_encode(['success' => false, 'error' => 'This school portal has locked (30-day limit reached). Please contact Admin.']);
                    exit;
                }

                $stmt = $pdo->prepare("SELECT * FROM teachers WHERE school_id = ? AND username = ?");
                $stmt->execute([$school['id'], $username]);
                $teacher = $stmt->fetch();
                
                if ($teacher && password_verify($password, $teacher['password_hash'])) {
                    $_SESSION['role'] = 'teacher';
                    $_SESSION['username'] = $username;
                    $_SESSION['school_id'] = $school['id'];
                    echo json_encode(['success' => true, 'role' => 'teacher']);
                } else {
                    http_response_code(401);
                    echo json_encode(['success' => false, 'error' => 'Invalid teacher credentials.']);
                }
            } else {
                http_response_code(404);
                echo json_encode(['success' => false, 'error' => 'School code not found.']);
            }
        } 
        else if ($role === 'student') {
            $school_code = isset($input['school_code']) ? $input['school_code'] : '';
            $student_code = isset($input['student_code']) ? $input['student_code'] : '';
            
            $stmt = $pdo->prepare("SELECT * FROM schools WHERE school_code = ?");
            $stmt->execute([$school_code]);
            $school = $stmt->fetch();
            
            if ($school) {
                $days = getSchoolRemainingDays($school['id']);
                if ($days <= 0) {
                    http_response_code(403);
                    echo json_encode(['success' => false, 'error' => 'This school portal has locked (30-day limit reached). Please contact Admin.']);
                    exit;
                }

                if ($school['election_status'] !== 'started' && $school['election_status'] !== 'mock') {
                    http_response_code(400);
                    echo json_encode(['success' => false, 'error' => 'Election is not currently active at this school. Status: ' . $school['election_status']]);
                    exit;
                }

                $stmt = $pdo->prepare("SELECT s.*, g.name as group_name FROM students s JOIN groups g ON s.group_id = g.id WHERE s.school_id = ? AND s.student_code = ?");
                $stmt->execute([$school['id'], $student_code]);
                $student = $stmt->fetch();
                
                if ($student) {
                    if ($student['has_voted']) {
                        http_response_code(400);
                        echo json_encode(['success' => false, 'error' => 'You have already casted your vote.']);
                    } else {
                        $_SESSION['role'] = 'student';
                        $_SESSION['username'] = $student['name'];
                        $_SESSION['student_code'] = $student_code;
                        $_SESSION['student_id'] = $student['id'];
                        $_SESSION['school_id'] = $school['id'];
                        $_SESSION['group_id'] = $student['group_id'];
                        $_SESSION['gender'] = $student['gender'];
                        echo json_encode([
                            'success' => true, 
                            'role' => 'student',
                            'student' => [
                                'name' => $student['name'],
                                'student_code' => $student['student_code'],
                                'group_name' => $student['group_name'],
                                'gender' => $student['gender']
                            ]
                        ]);
                    }
                } else {
                    http_response_code(404);
                    echo json_encode(['success' => false, 'error' => 'Student ID not found in this school records.']);
                }
            } else {
                http_response_code(404);
                echo json_encode(['success' => false, 'error' => 'School code not found.']);
            }
        } 
        else {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Invalid login role.']);
        }
        break;

    case 'logout':
        session_destroy();
        echo json_encode(['success' => true, 'message' => 'Logged out successfully.']);
        break;

    // --- SUPER ADMIN ACTIONS ---
    
    case 'admin_get_schools':
        requireRole(['admin']);
        $stmt = $pdo->query("SELECT s.*, 
            (SELECT COUNT(*) FROM teachers t WHERE t.school_id = s.id) as teacher_count,
            (SELECT COUNT(*) FROM students st WHERE st.school_id = s.id) as student_count
            FROM schools s ORDER BY s.id DESC");
        $schools = $stmt->fetchAll();
        // Append remaining days
        foreach ($schools as &$s) {
            $s['days_remaining'] = getSchoolRemainingDays($s['id']);
        }
        echo json_encode($schools);
        break;

    case 'admin_create_school':
        requireRole(['admin']);
        $name = isset($input['name']) ? trim($input['name']) : '';
        $school_code = isset($input['school_code']) ? trim($input['school_code']) : '';
        $principal_password = isset($input['principal_password']) ? trim($input['principal_password']) : '';

        if (empty($name) || empty($school_code) || empty($principal_password)) {
            http_response_code(400);
            echo json_encode(['error' => 'All fields (name, code, principal password) are required.']);
            exit;
        }

        // Validate unique code
        $stmt = $pdo->prepare("SELECT id FROM schools WHERE school_code = ?");
        $stmt->execute([$school_code]);
        if ($stmt->fetch()) {
            http_response_code(400);
            echo json_encode(['error' => 'School code already exists. Please choose a unique one.']);
            exit;
        }

        try {
            $pdo->beginTransaction();

            $p_hash = password_hash($principal_password, PASSWORD_DEFAULT);
            $stmt = $pdo->prepare("INSERT INTO schools (name, school_code, principal_password_hash) VALUES (?, ?, ?)");
            $stmt->execute([$name, $school_code, $p_hash]);
            $new_school_id = $pdo->lastInsertId();

            // Insert 6 default groups
            $default_groups = [
                ['name' => 'Red House', 'type' => 'house'],
                ['name' => 'Blue House', 'type' => 'house'],
                ['name' => 'Green House', 'type' => 'house'],
                ['name' => 'Yellow House', 'type' => 'house'],
                ['name' => 'Head Boy & Girl', 'type' => 'head'],
                ['name' => 'Sports Captain', 'type' => 'sport']
            ];
            $stmt_grp = $pdo->prepare("INSERT INTO groups (school_id, name, type, is_visible) VALUES (?, ?, ?, 1)");
            foreach ($default_groups as $dg) {
                $stmt_grp->execute([$new_school_id, $dg['name'], $dg['type']]);
            }

            $pdo->commit();
            echo json_encode(['success' => true, 'school_id' => $new_school_id, 'message' => 'School created with default groups.']);
        } catch (Exception $e) {
            $pdo->rollBack();
            http_response_code(500);
            echo json_encode(['error' => 'Database transaction failed: ' . $e->getMessage()]);
        }
        break;

    case 'admin_delete_school':
        requireRole(['admin']);
        $del_id = isset($input['school_id']) ? intval($input['school_id']) : 0;
        if ($del_id <= 0) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid school ID.']);
            exit;
        }
        $stmt = $pdo->prepare("DELETE FROM schools WHERE id = ?");
        $stmt->execute([$del_id]);
        echo json_encode(['success' => true, 'message' => 'School deleted successfully.']);
        break;

    case 'admin_get_school_data':
        requireRole(['admin']);
        $inspect_id = isset($_GET['school_id']) ? intval($_GET['school_id']) : 0;
        if ($inspect_id <= 0) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid school ID.']);
            exit;
        }

        // Fetch School Info
        $stmt = $pdo->prepare("SELECT * FROM schools WHERE id = ?");
        $stmt->execute([$inspect_id]);
        $school = $stmt->fetch();
        if (!$school) {
            http_response_code(404);
            echo json_encode(['error' => 'School not found.']);
            exit;
        }

        // Teachers list
        $stmt = $pdo->prepare("SELECT id, username FROM teachers WHERE school_id = ?");
        $stmt->execute([$inspect_id]);
        $teachers = $stmt->fetchAll();

        // Groups list
        $stmt = $pdo->prepare("SELECT * FROM groups WHERE school_id = ?");
        $stmt->execute([$inspect_id]);
        $groups = $stmt->fetchAll();

        // Candidates list
        $stmt = $pdo->prepare("SELECT s.*, g.name as group_name FROM students s JOIN groups g ON s.group_id = g.id WHERE s.school_id = ? AND s.is_candidate = 1");
        $stmt->execute([$inspect_id]);
        $candidates = $stmt->fetchAll();

        // Student Counts
        $stmt = $pdo->prepare("SELECT COUNT(*) as total, SUM(has_voted) as voted FROM students WHERE school_id = ?");
        $stmt->execute([$inspect_id]);
        $counts = $stmt->fetch();

        echo json_encode([
            'school' => $school,
            'days_remaining' => getSchoolRemainingDays($inspect_id),
            'teachers' => $teachers,
            'groups' => $groups,
            'candidates' => $candidates,
            'stats' => [
                'total_students' => intval($counts['total']),
                'voted_students' => intval($counts['voted'])
            ]
        ]);
        break;

    // --- PRINCIPAL ACTIONS ---

    case 'principal_get_dashboard':
        requireRole(['principal']);
        requireNotLocked();
        
        // Teachers list
        $stmt = $pdo->prepare("SELECT id, username FROM teachers WHERE school_id = ?");
        $stmt->execute([$school_id]);
        $teachers = $stmt->fetchAll();

        // Groups list
        $stmt = $pdo->prepare("SELECT * FROM groups WHERE school_id = ?");
        $stmt->execute([$school_id]);
        $groups = $stmt->fetchAll();

        // Stats
        $stmt = $pdo->prepare("SELECT COUNT(*) as total, SUM(has_voted) as voted FROM students WHERE school_id = ?");
        $stmt->execute([$school_id]);
        $counts = $stmt->fetch();

        echo json_encode([
            'teachers' => $teachers,
            'groups' => $groups,
            'stats' => [
                'total_students' => intval($counts['total']),
                'voted_students' => intval($counts['voted'])
            ]
        ]);
        break;

    case 'principal_add_teacher':
        requireRole(['principal']);
        requireNotLocked();
        $username = isset($input['username']) ? trim($input['username']) : '';
        $password = isset($input['password']) ? trim($input['password']) : '';

        if (empty($username) || empty($password)) {
            http_response_code(400);
            echo json_encode(['error' => 'Username and Password are required.']);
            exit;
        }

        // Check if teacher count >= 5
        $stmt = $pdo->prepare("SELECT COUNT(*) FROM teachers WHERE school_id = ?");
        $stmt->execute([$school_id]);
        $count = $stmt->fetchColumn();
        if ($count >= 5) {
            http_response_code(400);
            echo json_encode(['error' => 'Maximum limit of 5 teachers reached.']);
            exit;
        }

        // Check if username already exists in this school
        $stmt = $pdo->prepare("SELECT id FROM teachers WHERE school_id = ? AND username = ?");
        $stmt->execute([$school_id, $username]);
        if ($stmt->fetch()) {
            http_response_code(400);
            echo json_encode(['error' => 'A teacher with this username already exists in your school.']);
            exit;
        }

        $hash = password_hash($password, PASSWORD_DEFAULT);
        $stmt = $pdo->prepare("INSERT INTO teachers (school_id, username, password_hash) VALUES (?, ?, ?)");
        $stmt->execute([$school_id, $username, $hash]);

        echo json_encode(['success' => true, 'message' => 'Teacher account added successfully.']);
        break;

    case 'principal_update_teacher':
        requireRole(['principal']);
        requireNotLocked();
        $t_id = isset($input['teacher_id']) ? intval($input['teacher_id']) : 0;
        $new_pass = isset($input['password']) ? trim($input['password']) : '';

        if ($t_id <= 0 || empty($new_pass)) {
            http_response_code(400);
            echo json_encode(['error' => 'Teacher ID and new password are required.']);
            exit;
        }

        $hash = password_hash($new_pass, PASSWORD_DEFAULT);
        $stmt = $pdo->prepare("UPDATE teachers SET password_hash = ? WHERE id = ? AND school_id = ?");
        $stmt->execute([$hash, $t_id, $school_id]);

        if ($stmt->rowCount() > 0) {
            echo json_encode(['success' => true, 'message' => 'Teacher password updated successfully.']);
        } else {
            http_response_code(404);
            echo json_encode(['error' => 'Teacher not found or no changes made.']);
        }
        break;

    case 'principal_delete_teacher':
        requireRole(['principal']);
        requireNotLocked();
        $t_id = isset($input['teacher_id']) ? intval($input['teacher_id']) : 0;

        $stmt = $pdo->prepare("DELETE FROM teachers WHERE id = ? AND school_id = ?");
        $stmt->execute([$t_id, $school_id]);

        if ($stmt->rowCount() > 0) {
            echo json_encode(['success' => true, 'message' => 'Teacher account deleted.']);
        } else {
            http_response_code(404);
            echo json_encode(['error' => 'Teacher not found.']);
        }
        break;

    case 'principal_add_group':
        requireRole(['principal']);
        requireNotLocked();
        $g_name = isset($input['name']) ? trim($input['name']) : '';
        $g_type = isset($input['type']) ? trim($input['type']) : 'house';

        if (empty($g_name) || !in_array($g_type, ['house', 'head', 'sport'])) {
            http_response_code(400);
            echo json_encode(['error' => 'Valid Group Name and Type are required.']);
            exit;
        }

        $stmt = $pdo->prepare("INSERT INTO groups (school_id, name, type, is_visible) VALUES (?, ?, ?, 1)");
        $stmt->execute([$school_id, $g_name, $g_type]);
        
        echo json_encode(['success' => true, 'group_id' => $pdo->lastInsertId(), 'message' => 'Group added successfully.']);
        break;

    case 'principal_delete_group':
        requireRole(['principal']);
        requireNotLocked();
        $g_id = isset($input['group_id']) ? intval($input['group_id']) : 0;

        // Verify group belongs to this school
        $stmt = $pdo->prepare("SELECT id FROM groups WHERE id = ? AND school_id = ?");
        $stmt->execute([$g_id, $school_id]);
        if (!$stmt->fetch()) {
            http_response_code(404);
            echo json_encode(['error' => 'Group not found in your school.']);
            exit;
        }

        try {
            $pdo->beginTransaction();
            // Delete group
            $stmt = $pdo->prepare("DELETE FROM groups WHERE id = ? AND school_id = ?");
            $stmt->execute([$g_id, $school_id]);
            $pdo->commit();
            echo json_encode(['success' => true, 'message' => 'Group deleted successfully. Candidates associated with this group may lose group binding.']);
        } catch (Exception $e) {
            $pdo->rollBack();
            http_response_code(500);
            echo json_encode(['error' => 'Failed to delete group: ' . $e->getMessage()]);
        }
        break;

    case 'principal_set_group_visibility':
        requireRole(['principal']);
        requireNotLocked();
        $g_id = isset($input['group_id']) ? intval($input['group_id']) : 0;
        $visible = isset($input['is_visible']) ? intval($input['is_visible']) : 1;

        $stmt = $pdo->prepare("UPDATE groups SET is_visible = ? WHERE id = ? AND school_id = ?");
        $stmt->execute([$visible, $g_id, $school_id]);

        echo json_encode(['success' => true, 'message' => 'Group visibility updated.']);
        break;

    case 'principal_set_election_status':
        requireRole(['principal']);
        requireNotLocked();
        $status = isset($input['status']) ? trim($input['status']) : 'not_started';

        if (!in_array($status, ['not_started', 'started', 'mock', 'completed'])) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid election status.']);
            exit;
        }

        $stmt = $pdo->prepare("UPDATE schools SET election_status = ? WHERE id = ?");
        $stmt->execute([$status, $school_id]);

        echo json_encode(['success' => true, 'message' => 'Election status updated to ' . $status]);
        break;

    case 'principal_reset_election':
        requireRole(['principal']);
        requireNotLocked();

        try {
            $pdo->beginTransaction();
            // Reset students voting status
            $stmt = $pdo->prepare("UPDATE students SET has_voted = 0 WHERE school_id = ?");
            $stmt->execute([$school_id]);

            // Clear all votes
            $stmt = $pdo->prepare("DELETE FROM votes WHERE school_id = ?");
            $stmt->execute([$school_id]);

            $pdo->commit();
            echo json_encode(['success' => true, 'message' => 'Election data has been reset completely. All votes deleted.']);
        } catch (Exception $e) {
            $pdo->rollBack();
            http_response_code(500);
            echo json_encode(['error' => 'Failed to reset election data: ' . $e->getMessage()]);
        }
        break;

    case 'principal_get_results':
        requireRole(['principal', 'admin']);
        
        $req_school_id = ($user_role === 'admin' && isset($_GET['school_id'])) ? intval($_GET['school_id']) : $school_id;
        
        // 1. Fetch Candidates with Vote Count
        // We will sum the votes. If the election is currently in 'mock' status, we should check votes where is_mock = 1.
        // If it's normal status, we should count is_mock = 0.
        $stmt = $pdo->prepare("SELECT election_status FROM schools WHERE id = ?");
        $stmt->execute([$req_school_id]);
        $status = $stmt->fetchColumn() ?: 'not_started';
        $is_mock = ($status === 'mock') ? 1 : 0;

        $stmt = $pdo->prepare("
            SELECT s.id as candidate_id, s.name, s.gender, s.party_name, s.party_symbol, g.name as group_name, g.type as group_type, g.id as group_id,
            (SELECT COUNT(*) FROM votes v WHERE v.candidate_id = s.id AND v.is_mock = ?) as vote_count
            FROM students s 
            JOIN groups g ON s.group_id = g.id 
            WHERE s.school_id = ? AND s.is_candidate = 1
            ORDER BY g.type, g.id, s.gender, vote_count DESC
        ");
        $stmt->execute([$is_mock, $req_school_id]);
        $candidates = $stmt->fetchAll();

        // 2. Fetch voter turnout info
        $stmt = $pdo->prepare("SELECT COUNT(*) as total_voters, SUM(has_voted) as casted_voters FROM students WHERE school_id = ?");
        $stmt->execute([$req_school_id]);
        $voter_stats = $stmt->fetch();

        echo json_encode([
            'election_status' => $status,
            'is_mock' => $is_mock === 1,
            'candidates' => $candidates,
            'turnout' => [
                'total' => intval($voter_stats['total_voters']),
                'voted' => intval($voter_stats['casted_voters'])
            ]
        ]);
        break;

    // --- TEACHER ACTIONS ---

    case 'teacher_get_students':
        requireRole(['teacher']);
        requireNotLocked();

        // Retrieve group mapping for quick client display
        $stmt = $pdo->prepare("SELECT * FROM groups WHERE school_id = ?");
        $stmt->execute([$school_id]);
        $groups = $stmt->fetchAll();

        $stmt = $pdo->prepare("SELECT s.*, g.name as group_name FROM students s JOIN groups g ON s.group_id = g.id WHERE s.school_id = ? ORDER BY g.id, s.name");
        $stmt->execute([$school_id]);
        $students = $stmt->fetchAll();

        echo json_encode([
            'students' => $students,
            'groups' => $groups
        ]);
        break;

    case 'teacher_upsert_students':
        requireRole(['teacher']);
        requireNotLocked();

        $rows = isset($input['students']) ? $input['students'] : [];
        if (empty($rows)) {
            http_response_code(400);
            echo json_encode(['error' => 'No student data received.']);
            exit;
        }

        // Fetch groups mapping or create on the fly
        $stmt = $pdo->prepare("SELECT id, name FROM groups WHERE school_id = ?");
        $stmt->execute([$school_id]);
        $groups_db = $stmt->fetchAll();
        
        $groups_map = [];
        foreach ($groups_db as $g) {
            $groups_map[strtolower(trim($g['name']))] = $g['id'];
        }

        try {
            $pdo->beginTransaction();

            $stmt_insert_group = $pdo->prepare("INSERT INTO groups (school_id, name, type, is_visible) VALUES (?, ?, 'house', 1)");
            $stmt_check_student = $pdo->prepare("SELECT id FROM students WHERE school_id = ? AND student_code = ?");
            
            $stmt_insert_student = $pdo->prepare("
                INSERT INTO students 
                (school_id, student_code, name, gender, group_id, is_candidate, party_name, party_symbol) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ");
            
            $stmt_update_student = $pdo->prepare("
                UPDATE students SET 
                name = ?, gender = ?, group_id = ?, is_candidate = ?, party_name = ?, party_symbol = ?
                WHERE school_id = ? AND student_code = ?
            ");

            $imported = 0;
            $updated = 0;

            foreach ($rows as $row) {
                $code = isset($row['student_code']) ? trim($row['student_code']) : '';
                $name = isset($row['name']) ? trim($row['name']) : '';
                $gender = isset($row['gender']) ? strtolower(trim($row['gender'])) : 'boy';
                $group_name = isset($row['group_name']) ? trim($row['group_name']) : '';

                if (empty($code) || empty($name) || empty($group_name)) {
                    continue; // Skip invalid rows
                }

                // Map Gender to DB Standard
                if ($gender !== 'girl' && $gender !== 'boy') {
                    $gender = 'boy';
                }

                // Resolve group_id
                $group_key = strtolower($group_name);
                if (!isset($groups_map[$group_key])) {
                    // Create group of type house dynamically
                    $stmt_insert_group->execute([$school_id, $group_name]);
                    $new_group_id = $pdo->lastInsertId();
                    $groups_map[$group_key] = $new_group_id;
                }
                $group_id = $groups_map[$group_key];

                $is_candidate = isset($row['is_candidate']) ? intval($row['is_candidate']) : 0;
                $party_name = ($is_candidate && isset($row['party_name'])) ? trim($row['party_name']) : null;
                $party_symbol = ($is_candidate && isset($row['party_symbol'])) ? trim($row['party_symbol']) : null;

                // Check if student exists
                $stmt_check_student->execute([$school_id, $code]);
                $existing = $stmt_check_student->fetch();

                if ($existing) {
                    $stmt_update_student->execute([
                        $name, $gender, $group_id, $is_candidate, $party_name, $party_symbol,
                        $school_id, $code
                    ]);
                    $updated++;
                } else {
                    $stmt_insert_student->execute([
                        $school_id, $code, $name, $gender, $group_id, $is_candidate, $party_name, $party_symbol
                    ]);
                    $imported++;
                }
            }

            $pdo->commit();
            echo json_encode(['success' => true, 'message' => "Excel import processed successfully. Added: $imported, Updated: $updated students."]);
        } catch (Exception $e) {
            $pdo->rollBack();
            http_response_code(500);
            echo json_encode(['error' => 'Import transaction failed: ' . $e->getMessage()]);
        }
        break;

    case 'teacher_edit_student':
        requireRole(['teacher']);
        requireNotLocked();

        $id = isset($input['id']) ? intval($input['id']) : 0;
        $student_code = isset($input['student_code']) ? trim($input['student_code']) : '';
        $name = isset($input['name']) ? trim($input['name']) : '';
        $gender = isset($input['gender']) ? strtolower(trim($input['gender'])) : 'boy';
        $group_id = isset($input['group_id']) ? intval($input['group_id']) : 0;
        $is_candidate = isset($input['is_candidate']) ? intval($input['is_candidate']) : 0;
        $party_name = $is_candidate ? trim($input['party_name']) : null;
        $party_symbol = $is_candidate ? trim($input['party_symbol']) : null;

        if ($id <= 0 || empty($student_code) || empty($name) || $group_id <= 0) {
            http_response_code(400);
            echo json_encode(['error' => 'All basic student details are required.']);
            exit;
        }

        // Validate group exists in this school
        $stmt = $pdo->prepare("SELECT id FROM groups WHERE id = ? AND school_id = ?");
        $stmt->execute([$group_id, $school_id]);
        if (!$stmt->fetch()) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid student group association.']);
            exit;
        }

        // Validate code uniqueness for other students in school
        $stmt = $pdo->prepare("SELECT id FROM students WHERE school_id = ? AND student_code = ? AND id != ?");
        $stmt->execute([$school_id, $student_code, $id]);
        if ($stmt->fetch()) {
            http_response_code(400);
            echo json_encode(['error' => 'Roll number/Student code already used by another student.']);
            exit;
        }

        $stmt = $pdo->prepare("
            UPDATE students SET 
            student_code = ?, name = ?, gender = ?, group_id = ?, is_candidate = ?, party_name = ?, party_symbol = ?
            WHERE id = ? AND school_id = ?
        ");
        $stmt->execute([
            $student_code, $name, $gender, $group_id, $is_candidate, $party_name, $party_symbol, $id, $school_id
        ]);

        echo json_encode(['success' => true, 'message' => 'Student record updated successfully.']);
        break;

    case 'teacher_delete_student':
        requireRole(['teacher']);
        requireNotLocked();
        $id = isset($input['id']) ? intval($input['id']) : 0;

        $stmt = $pdo->prepare("DELETE FROM students WHERE id = ? AND school_id = ?");
        $stmt->execute([$id, $school_id]);

        if ($stmt->rowCount() > 0) {
            echo json_encode(['success' => true, 'message' => 'Student deleted successfully.']);
        } else {
            http_response_code(404);
            echo json_encode(['error' => 'Student not found in this school records.']);
        }
        break;

    case 'teacher_upload_symbol':
        requireRole(['teacher']);
        requireNotLocked();

        if (!isset($_FILES['symbol']) || $_FILES['symbol']['error'] !== UPLOAD_ERR_OK) {
            http_response_code(400);
            echo json_encode(['error' => 'No image file uploaded or upload error occurred.']);
            exit;
        }

        $file = $_FILES['symbol'];
        $allowed_types = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
        if (!in_array($file['type'], $allowed_types)) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid file format. Only JPG, PNG, GIF, WEBP and SVG are allowed.']);
            exit;
        }

        $ext = pathinfo($file['name'], PATHINFO_EXTENSION);
        $clean_filename = 'sym_' . uniqid() . '.' . $ext;
        $dest = __DIR__ . '/uploads/' . $clean_filename;

        if (move_uploaded_file($file['tmp_name'], $dest)) {
            echo json_encode([
                'success' => true,
                'path' => 'uploads/' . $clean_filename
            ]);
        } else {
            http_response_code(500);
            echo json_encode(['error' => 'Failed to save uploaded file. Check folder permissions.']);
        }
        break;

    // --- STUDENT VOTING BOOTH ACTIONS ---

    case 'student_get_election_info':
        requireRole(['student']);
        requireNotLocked();

        // 1. Get election state
        $stmt = $pdo->prepare("SELECT election_status FROM schools WHERE id = ?");
        $stmt->execute([$school_id]);
        $status = $stmt->fetchColumn();

        // 2. Fetch all groups that are visible for this school
        $stmt = $pdo->prepare("SELECT * FROM groups WHERE school_id = ? AND is_visible = 1");
        $stmt->execute([$school_id]);
        $groups = $stmt->fetchAll();

        // 3. Fetch candidates grouped by group_id and gender
        $stmt = $pdo->prepare("
            SELECT id, name, gender, group_id, party_name, party_symbol 
            FROM students 
            WHERE school_id = ? AND is_candidate = 1 
            ORDER BY group_id, gender, name
        ");
        $stmt->execute([$school_id]);
        $candidates = $stmt->fetchAll();

        echo json_encode([
            'status' => $status,
            'groups' => $groups,
            'candidates' => $candidates,
            'student_group_id' => $_SESSION['group_id']
        ]);
        break;

    case 'student_cast_vote':
        requireRole(['student']);
        requireNotLocked();

        $student_id_session = $_SESSION['student_id'];
        
        // Double-check if student already voted
        $stmt = $pdo->prepare("SELECT has_voted FROM students WHERE id = ? AND school_id = ?");
        $stmt->execute([$student_id_session, $school_id]);
        $voted_status = $stmt->fetchColumn();

        if ($voted_status) {
            http_response_code(400);
            echo json_encode(['error' => 'Double voting blocked. You have already casted your vote.']);
            exit;
        }

        // Retrieve current election status
        $stmt = $pdo->prepare("SELECT election_status FROM schools WHERE id = ?");
        $stmt->execute([$school_id]);
        $status = $stmt->fetchColumn();

        if ($status !== 'started' && $status !== 'mock') {
            http_response_code(400);
            echo json_encode(['error' => 'Voting is closed for this school. Current status: ' . $status]);
            exit;
        }

        $is_mock = ($status === 'mock') ? 1 : 0;
        $votes = isset($input['votes']) ? $input['votes'] : []; // Array of candidate_ids chosen

        if (empty($votes)) {
            http_response_code(400);
            echo json_encode(['error' => 'You must select candidates before casting your vote.']);
            exit;
        }

        try {
            $pdo->beginTransaction();

            // Insert votes
            $stmt_vote = $pdo->prepare("INSERT INTO votes (school_id, candidate_id, group_id, is_mock) VALUES (?, ?, ?, ?)");
            $stmt_candidate = $pdo->prepare("SELECT group_id FROM students WHERE id = ? AND school_id = ? AND is_candidate = 1");

            foreach ($votes as $c_id) {
                // Resolve candidate's group
                $stmt_candidate->execute([$c_id, $school_id]);
                $c_group_id = $stmt_candidate->fetchColumn();
                if ($c_group_id) {
                    $stmt_vote->execute([$school_id, $c_id, $c_group_id, $is_mock]);
                }
            }

            // Mark student as voted
            $stmt_mark = $pdo->prepare("UPDATE students SET has_voted = 1 WHERE id = ?");
            $stmt_mark->execute([$student_id_session]);

            $pdo->commit();
            // Clear student session so they are logged out after casting vote
            session_destroy();
            echo json_encode(['success' => true, 'message' => 'Vote casted successfully! Thank you for participating.']);
        } catch (Exception $e) {
            $pdo->rollBack();
            http_response_code(500);
            echo json_encode(['error' => 'Failed to record your vote: ' . $e->getMessage()]);
        }
        break;

    default:
        http_response_code(400);
        echo json_encode(['error' => 'Invalid API action request: ' . $action]);
        break;
}
