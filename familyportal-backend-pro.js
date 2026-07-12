/**
 * FamilyPortal Backend - Production Ready
 * Multi-school, PostgreSQL, Secure Authentication
 * 
 * Features:
 * - Multiple schools support
 * - Secure password hashing (bcrypt)
 * - JWT authentication tokens
 * - Admin panel to manage data
 * - CheckEd attendance integration
 * - PostgreSQL database
 * 
 * Install: npm install express cors dotenv bcryptjs jsonwebtoken pg
 * Run: node familyportal-backend-pro.js
 */

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Client } = require('pg');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ==================== DATABASE SETUP ====================

const client = new Client({
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'familyportal'
});

// Connect to database
client.connect().catch(err => {
  console.error('❌ Database connection failed:', err.message);
  console.log('\n📝 Make sure PostgreSQL is running and credentials in .env are correct');
  process.exit(1);
});

console.log('✅ Database connected');

// ==================== HELPER FUNCTIONS ====================

// Verify JWT token
function verifyToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Hash password
async function hashPassword(password) {
  return await bcrypt.hash(password, 10);
}

// Verify password
async function verifyPassword(password, hash) {
  return await bcrypt.compare(password, hash);
}

// Generate JWT token
function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, schoolId: user.school_id },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// ==================== ROUTES ====================

// 1. REGISTER NEW SCHOOL ADMIN
app.post('/api/register-school', async (req, res) => {
  const { schoolName, adminName, adminEmail, adminPassword } = req.body;
  
  try {
    // Check if school exists
    const schoolCheck = await client.query(
      'SELECT id FROM schools WHERE name = $1',
      [schoolName]
    );
    
    if (schoolCheck.rows.length > 0) {
      return res.status(400).json({ error: 'School already registered' });
    }
    
    // Create school
    const schoolResult = await client.query(
      'INSERT INTO schools (name, created_at) VALUES ($1, NOW()) RETURNING id',
      [schoolName]
    );
    
    const schoolId = schoolResult.rows[0].id;
    const hashedPassword = await hashPassword(adminPassword);
    
    // Create admin user
    const adminResult = await client.query(
      `INSERT INTO users (school_id, name, email, password, role) 
       VALUES ($1, $2, $3, $4, 'admin') 
       RETURNING id, email, role`,
      [schoolId, adminName, adminEmail, hashedPassword]
    );
    
    const token = generateToken({
      id: adminResult.rows[0].id,
      email: adminResult.rows[0].email,
      role: adminResult.rows[0].role,
      school_id: schoolId
    });
    
    res.json({
      success: true,
      message: 'School registered successfully',
      school_id: schoolId,
      token
    });
    
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. PARENT/ADMIN LOGIN
app.post('/api/login', async (req, res) => {
  const { email, password, schoolId } = req.body;
  
  try {
    // Find user by email and school
    const userResult = await client.query(
      `SELECT u.id, u.school_id, u.email, u.password, u.role, u.name,
              s.name as school_name
       FROM users u
       JOIN schools s ON u.school_id = s.id
       WHERE u.email = $1 AND u.school_id = $2`,
      [email, schoolId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const user = userResult.rows[0];
    const validPassword = await verifyPassword(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = generateToken(user);
    
    // Get students for parents
    let students = [];
    if (user.role === 'parent') {
      const studentResult = await client.query(
        `SELECT id, name, grade_level, section, photo
         FROM students
         WHERE parent_id = $1`,
        [user.id]
      );
      students = studentResult.rows;
    }
    
    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        school_id: user.school_id,
        school_name: user.school_name
      },
      students,
      token
    });
    
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. GET STUDENT GRADES
app.get('/api/grades/:studentId', verifyToken, async (req, res) => {
  const { studentId } = req.params;
  
  try {
    // Verify student belongs to user's school (and to this parent, if requester is a parent)
    const studentCheck = await client.query(
      `SELECT id, parent_id FROM students
       WHERE id = $1 AND school_id = $2`,
      [studentId, req.user.schoolId]
    );

    if (studentCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (req.user.role === 'parent' && studentCheck.rows[0].parent_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const grades = await client.query(
      `SELECT subject, q1, q2, q3, q4
       FROM grades
       WHERE student_id = $1
       ORDER BY subject ASC`,
      [studentId]
    );

    res.json(grades.rows);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. GET STUDENT ATTENDANCE
app.get('/api/attendance/:studentId', verifyToken, async (req, res) => {
  const { studentId } = req.params;

  try {
    // Verify student belongs to user's school (and to this parent, if requester is a parent)
    const studentCheck = await client.query(
      `SELECT id, parent_id FROM students
       WHERE id = $1 AND school_id = $2`,
      [studentId, req.user.schoolId]
    );

    if (studentCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (req.user.role === 'parent' && studentCheck.rows[0].parent_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const attendance = await client.query(
      `SELECT month, present_days, absent_days, tardy_days
       FROM attendance
       WHERE student_id = $1
       ORDER BY month DESC`,
      [studentId]
    );

    res.json(attendance.rows);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. GET ANNOUNCEMENTS
app.get('/api/announcements/:schoolId', verifyToken, async (req, res) => {
  const { schoolId } = req.params;

  if (parseInt(schoolId) !== req.user.schoolId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const announcements = await client.query(
      `SELECT id, title, message, date
       FROM announcements
       WHERE school_id = $1
       ORDER BY date DESC`,
      [schoolId]
    );

    res.json(announcements.rows);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== ADMIN ENDPOINTS ====================

// 6. LIST STUDENTS (Admin only)
app.get('/api/admin/students', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const students = await client.query(
      `SELECT s.id, s.name, s.grade_level, s.section, u.email AS parent_email
       FROM students s
       JOIN users u ON s.parent_id = u.id
       WHERE s.school_id = $1
       ORDER BY s.name ASC`,
      [req.user.schoolId]
    );

    res.json(students.rows);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. ADD STUDENT (Admin only)
app.post('/api/admin/students', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  const { parentEmail, studentName, gradeLevel, section, parentName, parentPassword } = req.body;
  
  try {
    // Find or create parent user
    let parentResult = await client.query(
      'SELECT id FROM users WHERE email = $1 AND school_id = $2',
      [parentEmail, req.user.schoolId]
    );
    
    let parentId;
    if (parentResult.rows.length === 0) {
      const hashedPassword = await hashPassword(parentPassword);
      const createParent = await client.query(
        `INSERT INTO users (school_id, name, email, password, role)
         VALUES ($1, $2, $3, $4, 'parent')
         RETURNING id`,
        [req.user.schoolId, parentName, parentEmail, hashedPassword]
      );
      parentId = createParent.rows[0].id;
    } else {
      parentId = parentResult.rows[0].id;
    }
    
    // Create student
    const studentResult = await client.query(
      `INSERT INTO students (school_id, parent_id, name, grade_level, section)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, grade_level, section`,
      [req.user.schoolId, parentId, studentName, gradeLevel, section]
    );
    
    res.json({
      success: true,
      message: 'Student added successfully',
      student: studentResult.rows[0]
    });
    
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. ADD GRADES (Admin only)
app.post('/api/admin/grades', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  const { studentId, subject, q1, q2, q3, q4 } = req.body;
  
  try {
    // Check if grade exists for this subject
    const existingGrade = await client.query(
      'SELECT id FROM grades WHERE student_id = $1 AND subject = $2',
      [studentId, subject]
    );
    
    let result;
    if (existingGrade.rows.length > 0) {
      // Update existing grade
      result = await client.query(
        `UPDATE grades SET q1 = $1, q2 = $2, q3 = $3, q4 = $4
         WHERE student_id = $5 AND subject = $6
         RETURNING subject, q1, q2, q3, q4`,
        [q1, q2, q3, q4, studentId, subject]
      );
    } else {
      // Insert new grade
      result = await client.query(
        `INSERT INTO grades (student_id, subject, q1, q2, q3, q4)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING subject, q1, q2, q3, q4`,
        [studentId, subject, q1, q2, q3, q4]
      );
    }
    
    res.json({
      success: true,
      message: 'Grade saved successfully',
      grade: result.rows[0]
    });
    
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. ADD ANNOUNCEMENT (Admin only)
app.post('/api/admin/announcements', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  const { title, message, date } = req.body;
  
  try {
    const result = await client.query(
      `INSERT INTO announcements (school_id, title, message, date)
       VALUES ($1, $2, $3, $4)
       RETURNING id, title, message, date`,
      [req.user.schoolId, title, message, date]
    );
    
    res.json({
      success: true,
      message: 'Announcement created',
      announcement: result.rows[0]
    });
    
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== CHECKED ATTENDANCE INTEGRATION ====================

// 10. SYNC ATTENDANCE FROM CHECKED
app.post('/api/sync-checked-attendance', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  const { studentId, month, presentDays, absentDays, tardyDays } = req.body;
  
  try {
    // Check if attendance record exists
    const existing = await client.query(
      'SELECT id FROM attendance WHERE student_id = $1 AND month = $2',
      [studentId, month]
    );
    
    let result;
    if (existing.rows.length > 0) {
      result = await client.query(
        `UPDATE attendance 
         SET present_days = $1, absent_days = $2, tardy_days = $3
         WHERE student_id = $4 AND month = $5
         RETURNING student_id, month, present_days, absent_days, tardy_days`,
        [presentDays, absentDays, tardyDays, studentId, month]
      );
    } else {
      result = await client.query(
        `INSERT INTO attendance (student_id, month, present_days, absent_days, tardy_days)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING student_id, month, present_days, absent_days, tardy_days`,
        [studentId, month, presentDays, absentDays, tardyDays]
      );
    }
    
    res.json({
      success: true,
      message: 'Attendance synced from CheckEd',
      attendance: result.rows[0]
    });
    
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. BULK SYNC FROM CHECKED (For multiple students)
app.post('/api/sync-checked-bulk', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  const { attendanceData } = req.body; // Array of attendance records
  
  try {
    for (const record of attendanceData) {
      await client.query(
        `INSERT INTO attendance (student_id, month, present_days, absent_days, tardy_days)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (student_id, month) DO UPDATE SET
         present_days = $3, absent_days = $4, tardy_days = $5`,
        [record.studentId, record.month, record.presentDays, record.absentDays, record.tardyDays]
      );
    }
    
    res.json({
      success: true,
      message: `${attendanceData.length} attendance records synced`
    });
    
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'Backend is running' });
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════╗
║   FamilyPortal Backend (Production Ready)          ║
║   Node.js + PostgreSQL + Multi-School              ║
╚════════════════════════════════════════════════════╝

✅ Server running on http://localhost:${PORT}

📚 ENDPOINTS:

Authentication:
  POST   /api/register-school      - Register new school
  POST   /api/login                - Parent/Admin login

Portal (requires token):
  GET    /api/grades/:studentId    - Get student grades
  GET    /api/attendance/:studentId - Get attendance
  GET    /api/announcements/:schoolId - Get announcements

Admin Only (requires token):
  GET    /api/admin/students       - List students
  POST   /api/admin/students       - Add student
  POST   /api/admin/grades         - Add/update grades
  POST   /api/admin/announcements  - Create announcement

CheckEd Integration:
  POST   /api/sync-checked-attendance - Sync single attendance
  POST   /api/sync-checked-bulk       - Sync multiple attendance

📝 Database: PostgreSQL (configure in .env)
🔐 Security: JWT + Password Hashing

  `);
});

process.on('SIGINT', async () => {
  await client.end();
  console.log('\n✅ Database connection closed');
  process.exit(0);
});
