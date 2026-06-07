<?php
// seed_dummy_data.php
// Script to seed dummy candidates with high-quality symbol images and set up a demo school.

header('Content-Type: application/json; charset=utf-8');

$config_file = __DIR__ . '/db_config.php';

if (!file_exists($config_file)) {
    http_response_code(400);
    echo json_encode([
        'success' => false,
        'message' => 'db_config.php not found. Please complete the database installation wizard first by opening the homepage.'
    ]);
    exit;
}

require_once $config_file;

try {
    $pdo = new PDO("mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4", DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
    ]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Database connection failed: ' . $e->getMessage()
    ]);
    exit;
}

try {
    $pdo->beginTransaction();

    // 1. Get or Create Demo School
    $stmt = $pdo->prepare("SELECT * FROM schools LIMIT 1");
    $stmt->execute();
    $school = $stmt->fetch();

    if (!$school) {
        // Create a default Demo School
        $school_code = 'DEMO11';
        $principal_hash = password_hash('password', PASSWORD_DEFAULT);
        $expires = date('Y-m-d H:i:s', strtotime('+30 days'));
        
        $stmt_ins = $pdo->prepare("INSERT INTO schools (name, school_code, principal_password_hash, election_status, expires_at) VALUES (?, ?, ?, ?, ?)");
        $stmt_ins->execute([
            'Nexus International School',
            $school_code,
            $principal_hash,
            'started', // Set to started for immediate demo
            $expires
        ]);
        
        $school_id = $pdo->lastInsertId();
        $school = [
            'id' => $school_id,
            'name' => 'Nexus International School',
            'school_code' => $school_code,
            'election_status' => 'started'
        ];
    } else {
        $school_id = $school['id'];
        // Ensure status is started or mock for immediate voting demo
        if ($school['election_status'] === 'not_started' || $school['election_status'] === 'completed') {
            $stmt_up = $pdo->prepare("UPDATE schools SET election_status = 'started' WHERE id = ?");
            $stmt_up->execute([$school_id]);
            $school['election_status'] = 'started';
        }
    }

    // 2. Ensure a default teacher account exists
    $stmt_t = $pdo->prepare("SELECT COUNT(*) FROM teachers WHERE school_id = ?");
    $stmt_t->execute([$school_id]);
    if ($stmt_t->fetchColumn() == 0) {
        $teacher_hash = password_hash('password', PASSWORD_DEFAULT);
        $stmt_ins_t = $pdo->prepare("INSERT INTO teachers (school_id, username, password_hash) VALUES (?, ?, ?)");
        $stmt_ins_t->execute([$school_id, 'teacher1', $teacher_hash]);
    }

    // 3. Delete any existing candidate records under this school to avoid duplicates and ensure a clean seed
    $pdo->exec("DELETE FROM votes WHERE school_id = $school_id");
    $pdo->exec("DELETE FROM students WHERE school_id = $school_id");
    $pdo->exec("DELETE FROM groups WHERE school_id = $school_id");

    // 4. Create groups
    $groups = [
        ['name' => 'Red House', 'type' => 'house'],
        ['name' => 'Blue House', 'type' => 'house'],
        ['name' => 'Green House', 'type' => 'house']
    ];

    $groups_map = [];
    $stmt_ins_g = $pdo->prepare("INSERT INTO groups (school_id, name, type, is_visible) VALUES (?, ?, ?, 1)");
    foreach ($groups as $g) {
        $stmt_ins_g->execute([$school_id, $g['name'], $g['type']]);
        $groups_map[$g['name']] = $pdo->lastInsertId();
    }

    // 5. Seed Candidates (8-10 mix of boys & girls for each group)
    $candidates_dataset = [
        'Red House' => [
            ['name' => 'Alan Turing', 'gender' => 'boy', 'party' => 'Tech Party', 'symbol' => 'https://img.icons8.com/color/96/shield.png'],
            ['name' => 'Grace Hopper', 'gender' => 'girl', 'party' => 'Tech Party', 'symbol' => 'https://img.icons8.com/color/96/shield.png'],
            ['name' => 'Albert Einstein', 'gender' => 'boy', 'party' => 'Science Club', 'symbol' => 'https://img.icons8.com/color/96/target.png'],
            ['name' => 'Marie Curie', 'gender' => 'girl', 'party' => 'Science Club', 'symbol' => 'https://img.icons8.com/color/96/target.png'],
            ['name' => 'Isaac Newton', 'gender' => 'boy', 'party' => 'Gravity Party', 'symbol' => 'https://img.icons8.com/color/96/star.png'],
            ['name' => 'Ada Lovelace', 'gender' => 'girl', 'party' => 'Gravity Party', 'symbol' => 'https://img.icons8.com/color/96/star.png'],
            ['name' => 'Nikola Tesla', 'gender' => 'boy', 'party' => 'Lightning Alliance', 'symbol' => 'https://img.icons8.com/color/96/sword.png'],
            ['name' => 'Rosalind Franklin', 'gender' => 'girl', 'party' => 'Lightning Alliance', 'symbol' => 'https://img.icons8.com/color/96/sword.png'],
            ['name' => 'Charles Darwin', 'gender' => 'boy', 'party' => 'Nature Coalition', 'symbol' => 'https://img.icons8.com/color/96/anchor.png'],
            ['name' => 'Katherine Johnson', 'gender' => 'girl', 'party' => 'Nature Coalition', 'symbol' => 'https://img.icons8.com/color/96/anchor.png']
        ],
        'Blue House' => [
            ['name' => 'John F. Kennedy', 'gender' => 'boy', 'party' => 'Liberty Union', 'symbol' => 'https://img.icons8.com/color/96/crown.png'],
            ['name' => 'Eleanor Roosevelt', 'gender' => 'girl', 'party' => 'Liberty Union', 'symbol' => 'https://img.icons8.com/color/96/crown.png'],
            ['name' => 'Winston Churchill', 'gender' => 'boy', 'party' => 'Victory Front', 'symbol' => 'https://img.icons8.com/color/96/trophy.png'],
            ['name' => 'Margaret Thatcher', 'gender' => 'girl', 'party' => 'Victory Front', 'symbol' => 'https://img.icons8.com/color/96/trophy.png'],
            ['name' => 'Nelson Mandela', 'gender' => 'boy', 'party' => 'Unity Alliance', 'symbol' => 'https://img.icons8.com/color/96/heart.png'],
            ['name' => 'Indira Gandhi', 'gender' => 'girl', 'party' => 'Unity Alliance', 'symbol' => 'https://img.icons8.com/color/96/heart.png'],
            ['name' => 'Abraham Lincoln', 'gender' => 'boy', 'party' => 'Honest Guild', 'symbol' => 'https://img.icons8.com/color/96/diamond.png'],
            ['name' => 'Golda Meir', 'gender' => 'girl', 'party' => 'Honest Guild', 'symbol' => 'https://img.icons8.com/color/96/diamond.png'],
            ['name' => 'Mahatma Gandhi', 'gender' => 'boy', 'party' => 'Peace Council', 'symbol' => 'https://img.icons8.com/color/96/spade.png'],
            ['name' => 'Mother Teresa', 'gender' => 'girl', 'party' => 'Peace Council', 'symbol' => 'https://img.icons8.com/color/96/spade.png']
        ],
        'Green House' => [
            ['name' => 'William Shakespeare', 'gender' => 'boy', 'party' => 'Drama Club', 'symbol' => 'https://img.icons8.com/color/96/shield.png'],
            ['name' => 'Jane Austen', 'gender' => 'girl', 'party' => 'Drama Club', 'symbol' => 'https://img.icons8.com/color/96/shield.png'],
            ['name' => 'Leonardo da Vinci', 'gender' => 'boy', 'party' => 'Renaissance', 'symbol' => 'https://img.icons8.com/color/96/target.png'],
            ['name' => 'Frida Kahlo', 'gender' => 'girl', 'party' => 'Renaissance', 'symbol' => 'https://img.icons8.com/color/96/target.png'],
            ['name' => 'Vincent van Gogh', 'gender' => 'boy', 'party' => 'Starry Night', 'symbol' => 'https://img.icons8.com/color/96/star.png'],
            ['name' => 'Georgia O\'Keeffe', 'gender' => 'girl', 'party' => 'Starry Night', 'symbol' => 'https://img.icons8.com/color/96/star.png'],
            ['name' => 'Pablo Picasso', 'gender' => 'boy', 'party' => 'Cubism Front', 'symbol' => 'https://img.icons8.com/color/96/sword.png'],
            ['name' => 'Emily Dickinson', 'gender' => 'girl', 'party' => 'Cubism Front', 'symbol' => 'https://img.icons8.com/color/96/sword.png'],
            ['name' => 'Wolfgang Mozart', 'gender' => 'boy', 'party' => 'Harmony League', 'symbol' => 'https://img.icons8.com/color/96/anchor.png'],
            ['name' => 'Virginia Woolf', 'gender' => 'girl', 'party' => 'Harmony League', 'symbol' => 'https://img.icons8.com/color/96/anchor.png']
        ]
    ];

    $stmt_ins_s = $pdo->prepare("INSERT INTO students (school_id, student_code, name, gender, group_id, is_candidate, party_name, party_symbol, has_voted) VALUES (?, ?, ?, ?, ?, 1, ?, ?, 0)");
    
    foreach ($candidates_dataset as $group_name => $candidates) {
        $group_id = $groups_map[$group_name];
        foreach ($candidates as $index => $c) {
            $student_code = 'CAND_' . strtoupper(substr($group_name, 0, 1)) . '_' . ($index + 1);
            $stmt_ins_s->execute([
                $school_id,
                $student_code,
                $c['name'],
                $c['gender'],
                $group_id,
                $c['party'],
                $c['symbol']
            ]);
        }
    }

    $pdo->commit();

    echo json_encode([
        'success' => true,
        'message' => 'Dummy candidates seeded successfully!',
        'details' => [
            'school_name' => $school['name'],
            'school_code' => $school['school_code'],
            'election_status' => $school['election_status'],
            'credentials' => [
                'role' => 'Voting Booth (or Principal/Teacher)',
                'school_code' => $school['school_code'],
                'password' => 'password',
                'teacher_username' => 'teacher1',
                'teacher_password' => 'password'
            ]
        ]
    ], JSON_PRETTY_PRINT);

} catch (Exception $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Transaction failed: ' . $e->getMessage()
    ]);
}
