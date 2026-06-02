<?php
/**
 * School Election Management System - Database Installer
 * This script initializes the MySQL database connection, creates tables,
 * inserts the Super Admin, and generates `db_config.php`.
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

$config_file = __DIR__ . '/db_config.php';

// Action dispatcher
$action = isset($_GET['action']) ? $_GET['action'] : 'status';

if ($action === 'status') {
    if (file_exists($config_file)) {
        echo json_encode(['configured' => true, 'message' => 'System is already configured.']);
    } else {
        echo json_encode(['configured' => false, 'message' => 'Configuration required.']);
    }
    exit;
}

if ($action === 'setup') {
    if (file_exists($config_file)) {
        echo json_encode(['success' => false, 'message' => 'System is already configured. Delete db_config.php to re-initialize.']);
        exit;
    }

    $input = json_decode(file_get_contents('php://input'), true);

    if (empty($input['db_host']) || empty($input['db_name']) || empty($input['db_user']) || !isset($input['db_pass']) || empty($input['admin_user']) || empty($input['admin_pass'])) {
        echo json_encode(['success' => false, 'message' => 'All fields are required.']);
        exit;
    }

    $db_host = $input['db_host'];
    $db_name = $input['db_name'];
    $db_user = $input['db_user'];
    $db_pass = $input['db_pass'];
    $admin_user = $input['admin_user'];
    $admin_pass = $input['admin_pass'];

    // 1. Try to connect to MySQL (without selecting DB first, in case DB needs to be created)
    try {
        $pdo = new PDO("mysql:host=$db_host", $db_user, $db_pass, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_TIMEOUT => 5
        ]);
    } catch (PDOException $e) {
        echo json_encode(['success' => false, 'message' => 'Failed to connect to MySQL host: ' . $e->getMessage()]);
        exit;
    }

    // 2. Create database if it does not exist
    try {
        $pdo->exec("CREATE DATABASE IF NOT EXISTS `" . str_replace("`","``",$db_name) . "` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    } catch (PDOException $e) {
        echo json_encode(['success' => false, 'message' => 'Failed to create database: ' . $e->getMessage()]);
        exit;
    }

    // 3. Connect to the specific database
    try {
        $pdo = new PDO("mysql:host=$db_host;dbname=$db_name;charset=utf8mb4", $db_user, $db_pass, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION
        ]);
    } catch (PDOException $e) {
        echo json_encode(['success' => false, 'message' => 'Connected to host but failed to select database: ' . $e->getMessage()]);
        exit;
    }

    // 4. Create Tables
    try {
        // Table: admin
        $pdo->exec("CREATE TABLE IF NOT EXISTS `admin` (
            `username` VARCHAR(100) NOT NULL PRIMARY KEY,
            `password_hash` VARCHAR(255) NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // Table: schools
        $pdo->exec("CREATE TABLE IF NOT EXISTS `schools` (
            `id` INT AUTO_INCREMENT PRIMARY KEY,
            `name` VARCHAR(255) NOT NULL,
            `school_code` VARCHAR(50) NOT NULL UNIQUE,
            `principal_password_hash` VARCHAR(255) NOT NULL,
            `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            `expires_at` TIMESTAMP NULL DEFAULT NULL,
            `election_status` VARCHAR(20) DEFAULT 'not_started',
            `show_head` TINYINT(1) DEFAULT 1,
            `show_sport` TINYINT(1) DEFAULT 1
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // Table: groups
        $pdo->exec("CREATE TABLE IF NOT EXISTS `groups` (
            `id` INT AUTO_INCREMENT PRIMARY KEY,
            `school_id` INT NOT NULL,
            `name` VARCHAR(100) NOT NULL,
            `type` VARCHAR(20) NOT NULL, -- 'house', 'head', 'sport'
            `is_visible` TINYINT(1) DEFAULT 1,
            FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // Table: teachers
        $pdo->exec("CREATE TABLE IF NOT EXISTS `teachers` (
            `id` INT AUTO_INCREMENT PRIMARY KEY,
            `school_id` INT NOT NULL,
            `username` VARCHAR(100) NOT NULL,
            `password_hash` VARCHAR(255) NOT NULL,
            FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE,
            UNIQUE KEY `school_teacher_idx` (`school_id`, `username`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // Table: students
        $pdo->exec("CREATE TABLE IF NOT EXISTS `students` (
            `id` INT AUTO_INCREMENT PRIMARY KEY,
            `school_id` INT NOT NULL,
            `student_code` VARCHAR(100) NOT NULL,
            `name` VARCHAR(100) NOT NULL,
            `gender` VARCHAR(10) NOT NULL, -- 'boy', 'girl'
            `group_id` INT NOT NULL,
            `is_candidate` TINYINT(1) DEFAULT 0,
            `party_name` VARCHAR(100) DEFAULT NULL,
            `party_symbol` VARCHAR(255) DEFAULT NULL, -- Emoji code/text or image filepath
            `has_voted` TINYINT(1) DEFAULT 0,
            FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE,
            FOREIGN KEY (`group_id`) REFERENCES `groups` (`id`) ON DELETE CASCADE,
            UNIQUE KEY `school_student_idx` (`school_id`, `student_code`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // Table: votes
        $pdo->exec("CREATE TABLE IF NOT EXISTS `votes` (
            `id` INT AUTO_INCREMENT PRIMARY KEY,
            `school_id` INT NOT NULL,
            `candidate_id` INT NOT NULL,
            `group_id` INT NOT NULL,
            `is_mock` TINYINT(1) DEFAULT 0,
            FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE,
            FOREIGN KEY (`candidate_id`) REFERENCES `students` (`id`) ON DELETE CASCADE,
            FOREIGN KEY (`group_id`) REFERENCES `groups` (`id`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // 5. Insert Admin Account
        $admin_hash = password_hash($admin_pass, PASSWORD_DEFAULT);
        $stmt = $pdo->prepare("INSERT INTO `admin` (`username`, `password_hash`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `password_hash` = ?");
        $stmt->execute([$admin_user, $admin_hash, $admin_hash]);

    } catch (PDOException $e) {
        echo json_encode(['success' => false, 'message' => 'Failed to initialize database tables: ' . $e->getMessage()]);
        exit;
    }

    // 6. Write db_config.php
    $config_content = "<?php\n" .
                      "// School Election Management System - Auto-generated Database Config\n" .
                      "define('DB_HOST', " . var_export($db_host, true) . ");\n" .
                      "define('DB_NAME', " . var_export($db_name, true) . ");\n" .
                      "define('DB_USER', " . var_export($db_user, true) . ");\n" .
                      "define('DB_PASS', " . var_export($db_pass, true) . ");\n";

    if (file_put_contents($config_file, $config_content) === false) {
        echo json_encode(['success' => false, 'message' => 'Database tables created, but failed to write db_config.php. Verify directory write permissions.']);
        exit;
    }

    echo json_encode(['success' => true, 'message' => 'Configuration completed successfully! System is ready to use.']);
    exit;
}

echo json_encode(['success' => false, 'message' => 'Invalid action.']);
exit;
