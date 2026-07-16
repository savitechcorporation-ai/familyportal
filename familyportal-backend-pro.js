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
const path = require('path');
const sharp = require('sharp');
const { Client } = require('pg');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '8mb' })); // raised to fit base64-encoded logo/banner uploads (2MB/4MB caps)
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

// Middleware
app.use(cors());
app.use(express.json({ limit: '8mb' })); // raised to fit base64-encoded logo/banner uploads (2MB/4MB caps)
app.use(express.static(__dirname));

// Clean URL for the new admin portal (the file itself is still reachable at /admin-portal.html)
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin-portal.html'));
});

// ==================== BRANDING (public - login pages need this pre-auth) ====================
// This app is single-tenant-per-deployment in practice (every other page
// already defaults to schoolId=1, e.g. the demo login credentials and the
// SCHOOL_YEAR default) - branding follows the same convention.

app.get('/api/branding', async (req, res) => {
  const schoolId = parseInt(req.query.schoolId) || 1;

  try {
    const result = await client.query(
      `SELECT display_name, name, primary_color, accent_color,
              admin_portal_tagline, parent_portal_tagline,
              (logo IS NOT NULL) AS "hasLogo",
              (banner IS NOT NULL) AS "hasBanner",
              branding_updated_at
       FROM schools WHERE id = $1`,
      [schoolId]
    );

    if (result.rows.length === 0) {
      return res.json({
        display_name: null, primary_color: null, accent_color: null,
        admin_portal_tagline: null, parent_portal_tagline: null,
        hasLogo: false, hasBanner: false, updated_at: null
      });
    }

    const row = result.rows[0];
    res.json({
      display_name: row.display_name || row.name || null,
      primary_color: row.primary_color,
      accent_color: row.accent_color,
      admin_portal_tagline: row.admin_portal_tagline,
      parent_portal_tagline: row.parent_portal_tagline,
      hasLogo: row.hasLogo,
      hasBanner: row.hasBanner,
      updated_at: row.branding_updated_at
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function sendBrandingImage(req, res, column, contentTypeColumn) {
  const schoolId = parseInt(req.query.schoolId) || 1;

  try {
    const result = await client.query(
      `SELECT ${column} AS image, ${contentTypeColumn} AS content_type FROM schools WHERE id = $1`,
      [schoolId]
    );

    if (result.rows.length === 0 || !result.rows[0].image) {
      return res.status(404).end();
    }

    res.set('Content-Type', result.rows[0].content_type || 'image/png');
    res.set('Cache-Control', 'public, max-age=31536000, immutable'); // safe: frontend cache-busts via ?v=updated_at
    res.send(result.rows[0].image);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

app.get('/api/branding/logo', (req, res) => sendBrandingImage(req, res, 'logo', 'logo_content_type'));
app.get('/api/branding/banner', (req, res) => sendBrandingImage(req, res, 'banner', 'banner_content_type'));

// Covers browsers that request this path directly; both frontends also set
// an explicit <link rel="icon"> pointing at /api/branding/logo for reliability.
app.get('/favicon.ico', (req, res) => sendBrandingImage(req, res, 'logo', 'logo_content_type'));

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

// Identify an image by its actual bytes, not whatever content-type or
// extension the client claims - a renamed .txt file must not pass as a PNG.
function detectImageType(buffer) {
  if (buffer.length >= 8 &&
      buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return 'png';
  }
  if (buffer.length >= 3 &&
      buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'jpeg';
  }
  if (buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'webp';
  }
  return null;
}

// Cap dimensions server-side so a 20MP upload never gets served to every
// parent's phone. Format-preserving, never upscales a smaller source image.
async function resizeImage(buffer, maxWidth, maxHeight) {
  return sharp(buffer)
    .resize(maxWidth, maxHeight, { fit: 'inside', withoutEnlargement: true })
    .toBuffer();
}

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

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
  const { email, password, schoolId, studentNumber } = req.body;

  try {
    // Each child has its own login row, so email alone no longer uniquely
    // identifies an account. Admins are matched by email+school as before;
    // parents must also match the Student ID Number of the child that row
    // is scoped to.
    const userResult = await client.query(
      `SELECT u.id, u.school_id, u.email, u.password, u.role, u.name, s.name AS school_name,
              st.id AS student_id, st.name AS student_name, st.grade_level, st.section, st.photo,
              st.student_number, st.adviser
       FROM users u
       JOIN schools s ON u.school_id = s.id
       LEFT JOIN students st ON st.parent_id = u.id
       WHERE u.email = $1 AND u.school_id = $2
         AND (u.role = 'admin' OR st.student_number = $3)`,
      [email, schoolId, studentNumber || null]
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

    const students = (user.role === 'parent' && user.student_id)
      ? [{
          id: user.student_id, name: user.student_name, grade_level: user.grade_level,
          section: user.section, photo: user.photo, student_number: user.student_number,
          adviser: user.adviser
        }]
      : [];

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
  const schoolYear = req.query.schoolYear || '2026-2027';

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

    // Quarters are real rows now (not q1-q4 columns) so each can have its own
    // release status. Parents only see released quarters; staff see all.
    // Pivoted back into {subject, q1, q2, q3, q4} shape for frontend compatibility.
    const grades = await client.query(
      `SELECT
         g.subject_code AS subject,
         MAX(CASE WHEN q.sort_order = 1 THEN g.score END) AS q1,
         MAX(CASE WHEN q.sort_order = 2 THEN g.score END) AS q2,
         MAX(CASE WHEN q.sort_order = 3 THEN g.score END) AS q3,
         MAX(CASE WHEN q.sort_order = 4 THEN g.score END) AS q4
       FROM grades g
       JOIN quarters q ON q.id = g.quarter_id
       WHERE g.student_id = $1 AND q.school_year = $2
         AND ($3 = true OR q.status = 'released')
       GROUP BY g.subject_code
       ORDER BY g.subject_code ASC`,
      [studentId, schoolYear, req.user.role !== 'parent']
    );

    res.json(grades.rows);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. GET STUDENT ATTENDANCE
app.get('/api/attendance/:studentId', verifyToken, async (req, res) => {
  const { studentId } = req.params;
  const schoolYear = req.query.schoolYear || '2026-2027';

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

    // Same release-gating as grades. Aliased to the field names the
    // frontend already expects (it just sums these, doesn't care that this
    // used to be per-month and is now per-quarter). school_days is included
    // so the parent portal can compute the same present/school_days
    // attendance rate the admin dashboard shows.
    const attendance = await client.query(
      `SELECT
         q.short AS month,
         a.present AS present_days,
         a.absent AS absent_days,
         a.tardy AS tardy_days,
         a.school_days AS school_days
       FROM attendance a
       JOIN quarters q ON q.id = a.quarter_id
       WHERE a.student_id = $1 AND q.school_year = $2
         AND ($3 = true OR q.status = 'released')
       ORDER BY q.sort_order DESC`,
      [studentId, schoolYear, req.user.role !== 'parent']
    );

    res.json(attendance.rows);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4b. GET REMARKS & CORE VALUES for a student (parent-facing)
// Same release-gating pattern as grades/attendance above: parents only see
// quarters with status = 'released'; staff/admin see everything. This is
// where the parent portal's release check for remarks/values lives - no
// frontend on the parent side calls it yet (no Remarks UI exists there),
// but the data is already correctly gated for whenever that's built.
app.get('/api/remarks-values/:studentId', verifyToken, async (req, res) => {
  const { studentId } = req.params;
  const schoolYear = req.query.schoolYear || '2026-2027';

  try {
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

    const bypassRelease = req.user.role !== 'parent';

    const remarksResult = await client.query(
      `SELECT q.id AS quarter_id, q.label, q.short, r.body AS remarks
       FROM quarters q
       LEFT JOIN remarks r ON r.quarter_id = q.id AND r.student_id = $1
       WHERE q.school_id = $2 AND q.school_year = $3
         AND ($4 = true OR q.status = 'released')
       ORDER BY q.sort_order ASC`,
      [studentId, req.user.schoolId, schoolYear, bypassRelease]
    );

    const valuesResult = await client.query(
      `SELECT q.id AS quarter_id, vr.core_value, vr.rating
       FROM quarters q
       JOIN values_ratings vr ON vr.quarter_id = q.id AND vr.student_id = $1
       WHERE q.school_id = $2 AND q.school_year = $3
         AND ($4 = true OR q.status = 'released')`,
      [studentId, req.user.schoolId, schoolYear, bypassRelease]
    );

    const valuesByQuarter = {};
    valuesResult.rows.forEach(v => {
      if (!valuesByQuarter[v.quarter_id]) valuesByQuarter[v.quarter_id] = {};
      valuesByQuarter[v.quarter_id][v.core_value] = v.rating;
    });

    res.json(remarksResult.rows.map(r => ({
      quarter: r.label,
      short: r.short,
      remarks: r.remarks || null,
      values: valuesByQuarter[r.quarter_id] || {}
    })));

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

  const { gradeLevel, search, status, quarterId } = req.query;

  try {
    const conditions = ['s.school_id = $1'];
    const params = [req.user.schoolId];

    if (gradeLevel) {
      params.push(gradeLevel);
      conditions.push(`s.grade_level = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`s.status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(s.name ILIKE $${params.length} OR s.student_number ILIKE $${params.length})`);
    }

    // Optional per-quarter average (drives the "Q avg: XX" line in the UI)
    let averageSelect = 'NULL AS average';
    let averageJoin = '';
    if (quarterId) {
      params.push(quarterId);
      averageSelect = `ga.avg_score AS average`;
      averageJoin = `LEFT JOIN (
        SELECT student_id, AVG(score) AS avg_score
        FROM grades WHERE quarter_id = $${params.length} AND score IS NOT NULL
        GROUP BY student_id
      ) ga ON ga.student_id = s.id`;
    }

    const students = await client.query(
      `SELECT s.id, s.name, s.grade_level, s.section, s.student_number, s.adviser, s.status,
              u.email AS parent_email, u.name AS parent_name, u.phone AS parent_phone,
              ${averageSelect}
       FROM students s
       JOIN users u ON s.parent_id = u.id
       ${averageJoin}
       WHERE ${conditions.join(' AND ')}
       ORDER BY s.name ASC`,
      params
    );

    students.rows.forEach(s => {
      if (s.average !== null && s.average !== undefined) {
        s.average = Math.round(parseFloat(s.average) * 100) / 100;
      }
    });

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
  
  const { parentEmail, studentName, gradeLevel, section, parentName, parentPassword, studentNumber, adviser, parentPhone } = req.body;

  if (!studentNumber) {
    return res.status(400).json({ error: 'Student ID Number is required' });
  }

  try {
    // Each child gets its own login row - never reuse an existing parent
    // account, even if the email matches one already on file.
    const hashedPassword = await hashPassword(parentPassword);
    const createParent = await client.query(
      `INSERT INTO users (school_id, name, email, password, phone, role)
       VALUES ($1, $2, $3, $4, $5, 'parent')
       RETURNING id`,
      [req.user.schoolId, parentName, parentEmail, hashedPassword, parentPhone || null]
    );
    const parentId = createParent.rows[0].id;

    // Create student
    const studentResult = await client.query(
      `INSERT INTO students (school_id, parent_id, name, grade_level, section, student_number, adviser)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, grade_level, section, student_number, adviser, status`,
      [req.user.schoolId, parentId, studentName, gradeLevel, section, studentNumber, adviser || null]
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

// 7b. DELETE STUDENT (Admin only)
app.delete('/api/admin/students/:studentId', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { studentId } = req.params;

  try {
    const studentCheck = await client.query(
      'SELECT id, parent_id FROM students WHERE id = $1 AND school_id = $2',
      [studentId, req.user.schoolId]
    );

    if (studentCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const parentId = studentCheck.rows[0].parent_id;

    await client.query('DELETE FROM grades WHERE student_id = $1', [studentId]);
    await client.query('DELETE FROM attendance WHERE student_id = $1', [studentId]);
    await client.query('DELETE FROM remarks WHERE student_id = $1', [studentId]);
    await client.query('DELETE FROM values_ratings WHERE student_id = $1', [studentId]);
    await client.query('DELETE FROM students WHERE id = $1', [studentId]);

    // Only remove the parent account if they have no other children left
    const remainingChildren = await client.query(
      'SELECT id FROM students WHERE parent_id = $1',
      [parentId]
    );

    if (remainingChildren.rows.length === 0) {
      await client.query('DELETE FROM users WHERE id = $1', [parentId]);
    }

    res.json({ success: true, message: 'Student deleted successfully' });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7c. UPDATE STUDENT (Admin only) - adviser and/or active/inactive status
app.patch('/api/admin/students/:studentId', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { studentId } = req.params;
  const { adviser, status } = req.body;

  if (status && !['active', 'inactive'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    const studentCheck = await client.query(
      'SELECT id FROM students WHERE id = $1 AND school_id = $2',
      [studentId, req.user.schoolId]
    );

    if (studentCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const result = await client.query(
      `UPDATE students
       SET adviser = COALESCE($1, adviser), status = COALESCE($2, status)
       WHERE id = $3
       RETURNING id, name, grade_level, section, student_number, adviser, status`,
      [adviser, status, studentId]
    );

    res.json({ success: true, student: result.rows[0] });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7d. LIST QUARTERS (Admin only)
app.get('/api/admin/quarters', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const quarters = await client.query(
      `SELECT id, school_year, label, short, sort_order, status
       FROM quarters
       WHERE school_id = $1
       ORDER BY school_year DESC, sort_order ASC`,
      [req.user.schoolId]
    );

    res.json(quarters.rows);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7e. OVERVIEW STATS (Admin only) - always computed live, never cached
app.get('/api/admin/overview', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    let quarterId = req.query.quarterId;

    if (!quarterId) {
      const latestQuarter = await client.query(
        `SELECT id FROM quarters WHERE school_id = $1
         ORDER BY school_year DESC, sort_order DESC LIMIT 1`,
        [req.user.schoolId]
      );
      if (latestQuarter.rows.length === 0) {
        return res.status(404).json({ error: 'No quarters set up for this school yet' });
      }
      quarterId = latestQuarter.rows[0].id;
    }

    const quarterResult = await client.query(
      'SELECT id, label, short, school_year, status FROM quarters WHERE id = $1 AND school_id = $2',
      [quarterId, req.user.schoolId]
    );

    if (quarterResult.rows.length === 0) {
      return res.status(404).json({ error: 'Quarter not found' });
    }

    const quarter = quarterResult.rows[0];

    const activeCountResult = await client.query(
      `SELECT COUNT(*) FROM students WHERE school_id = $1 AND status = 'active'`,
      [req.user.schoolId]
    );
    const activeStudents = parseInt(activeCountResult.rows[0].count);

    const classAverageResult = await client.query(
      `SELECT AVG(g.score) AS avg
       FROM grades g
       JOIN students s ON s.id = g.student_id
       WHERE g.quarter_id = $1 AND s.school_id = $2 AND s.status = 'active' AND g.score IS NOT NULL`,
      [quarterId, req.user.schoolId]
    );
    const classAverage = classAverageResult.rows[0].avg !== null
      ? Math.round(parseFloat(classAverageResult.rows[0].avg) * 100) / 100
      : null;

    const attendanceRateResult = await client.query(
      `SELECT AVG(a.present::NUMERIC / NULLIF(a.school_days, 0)) AS rate
       FROM attendance a
       JOIN students s ON s.id = a.student_id
       WHERE a.quarter_id = $1 AND s.school_id = $2 AND s.status = 'active'`,
      [quarterId, req.user.schoolId]
    );
    const attendanceRate = attendanceRateResult.rows[0].rate !== null
      ? Math.round(parseFloat(attendanceRateResult.rows[0].rate) * 10000) / 100
      : null;

    const enrollmentResult = await client.query(
      `SELECT grade_level, COUNT(*) AS count
       FROM students
       WHERE school_id = $1 AND status = 'active'
       GROUP BY grade_level
       ORDER BY grade_level ASC`,
      [req.user.schoolId]
    );

    // Active students whose quarter average < 80 or attendance rate < 90%,
    // computed live from grades/attendance - never a stored/cached value.
    const attentionResult = await client.query(
      `SELECT s.id, s.name, s.grade_level, s.section, ga.avg_score, ar.rate
       FROM students s
       LEFT JOIN (
         SELECT student_id, AVG(score) AS avg_score
         FROM grades WHERE quarter_id = $1 AND score IS NOT NULL
         GROUP BY student_id
       ) ga ON ga.student_id = s.id
       LEFT JOIN (
         SELECT student_id, present::NUMERIC / NULLIF(school_days, 0) AS rate
         FROM attendance WHERE quarter_id = $1
       ) ar ON ar.student_id = s.id
       WHERE s.school_id = $2 AND s.status = 'active'
         AND ((ga.avg_score IS NOT NULL AND ga.avg_score < 80)
           OR (ar.rate IS NOT NULL AND ar.rate < 0.9))
       ORDER BY s.name ASC`,
      [quarterId, req.user.schoolId]
    );

    res.json({
      quarter,
      activeStudents,
      classAverage,
      attendanceRate,
      enrollmentByGradeLevel: enrollmentResult.rows,
      studentsNeedingAttention: attentionResult.rows.map(r => ({
        id: r.id,
        name: r.name,
        grade_level: r.grade_level,
        section: r.section,
        average: r.avg_score !== null ? Math.round(parseFloat(r.avg_score) * 100) / 100 : null,
        attendanceRate: r.rate !== null ? Math.round(parseFloat(r.rate) * 10000) / 100 : null
      }))
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET SUBJECTS for a grade level - any authenticated role (admin, teacher,
// parent). Subject names/codes aren't sensitive per-student data, just the
// school's course list, and parents need the full list (not only subjects
// that already have a grade row) to render a complete grades table on the
// Overview page. Scoped to the caller's own school_id.
app.get('/api/subjects', verifyToken, async (req, res) => {
  const { gradeLevel } = req.query;
  if (!gradeLevel) {
    return res.status(400).json({ error: 'gradeLevel is required' });
  }

  try {
    const subjects = await client.query(
      `SELECT code, name
       FROM subjects
       WHERE school_id = $1 AND grade_level = $2
       ORDER BY name ASC`,
      [req.user.schoolId, gradeLevel]
    );

    res.json(subjects.rows);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== GRADE ENTRY (Admin only) ====================

// 7f. LIST SUBJECTS for a grade level
app.get('/api/admin/subjects', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { gradeLevel } = req.query;
  if (!gradeLevel) {
    return res.status(400).json({ error: 'gradeLevel is required' });
  }

  try {
    const subjects = await client.query(
      `SELECT id, code, name, teacher_name
       FROM subjects
       WHERE school_id = $1 AND grade_level = $2
       ORDER BY name ASC`,
      [req.user.schoolId, gradeLevel]
    );

    res.json(subjects.rows);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7g. BULK GRADES for a grade level + subject + quarter
app.get('/api/admin/grades', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { gradeLevel, subjectCode, quarterId } = req.query;
  if (!gradeLevel || !subjectCode || !quarterId) {
    return res.status(400).json({ error: 'gradeLevel, subjectCode, and quarterId are required' });
  }

  try {
    const rows = await client.query(
      `SELECT s.id AS student_id, s.name, s.section, g.score
       FROM students s
       LEFT JOIN grades g ON g.student_id = s.id AND g.quarter_id = $1 AND g.subject_code = $2
       WHERE s.school_id = $3 AND s.grade_level = $4 AND s.status = 'active'
       ORDER BY s.name ASC`,
      [quarterId, subjectCode, req.user.schoolId, gradeLevel]
    );

    res.json(rows.rows);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7h. SAVE ONE GRADE
app.put('/api/admin/grades/:studentId/:quarterId/:subjectCode', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { studentId, quarterId, subjectCode } = req.params;
  const { score } = req.body;

  try {
    const studentCheck = await client.query(
      'SELECT id FROM students WHERE id = $1 AND school_id = $2',
      [studentId, req.user.schoolId]
    );
    if (studentCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    await client.query(
      `INSERT INTO grades (student_id, quarter_id, subject_code, score)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (student_id, quarter_id, subject_code) DO UPDATE SET score = $4`,
      [studentId, quarterId, subjectCode, score]
    );

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== ATTENDANCE (Admin only) ====================

// 7i. BULK ATTENDANCE for a grade level + quarter
app.get('/api/admin/attendance', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { gradeLevel, quarterId } = req.query;
  if (!quarterId) {
    return res.status(400).json({ error: 'quarterId is required' });
  }

  try {
    const conditions = [`s.school_id = $1`, `s.status = 'active'`];
    const params = [req.user.schoolId, quarterId];

    if (gradeLevel) {
      params.push(gradeLevel);
      conditions.push(`s.grade_level = $${params.length}`);
    }

    const rows = await client.query(
      `SELECT s.id AS student_id, s.name, s.grade_level, s.section,
              a.present, a.absent, a.tardy, a.school_days
       FROM students s
       LEFT JOIN attendance a ON a.student_id = s.id AND a.quarter_id = $2
       WHERE ${conditions.join(' AND ')}
       ORDER BY s.name ASC`,
      params
    );

    res.json(rows.rows);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7j. SAVE ONE STUDENT'S ATTENDANCE for a quarter
app.put('/api/admin/attendance/:studentId/:quarterId', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { studentId, quarterId } = req.params;
  const { present, absent, tardy, schoolDays } = req.body;

  try {
    const studentCheck = await client.query(
      'SELECT id FROM students WHERE id = $1 AND school_id = $2',
      [studentId, req.user.schoolId]
    );
    if (studentCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    await client.query(
      `INSERT INTO attendance (student_id, quarter_id, present, absent, tardy, school_days)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (student_id, quarter_id) DO UPDATE SET
       present = $3, absent = $4, tardy = $5, school_days = $6`,
      [studentId, quarterId, present, absent, tardy, schoolDays]
    );

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== REMARKS & VALUES (Admin only) ====================

// 7k. LIST REMARKS + VALUES for a quarter (all active students)
app.get('/api/admin/remarks-values', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { quarterId } = req.query;
  if (!quarterId) {
    return res.status(400).json({ error: 'quarterId is required' });
  }

  try {
    const students = await client.query(
      `SELECT s.id, s.name, s.grade_level, s.section, r.body AS remarks
       FROM students s
       LEFT JOIN remarks r ON r.student_id = s.id AND r.quarter_id = $1
       WHERE s.school_id = $2 AND s.status = 'active'
       ORDER BY s.name ASC`,
      [quarterId, req.user.schoolId]
    );

    const valuesResult = await client.query(
      `SELECT vr.student_id, vr.core_value, vr.rating
       FROM values_ratings vr
       JOIN students s ON s.id = vr.student_id
       WHERE vr.quarter_id = $1 AND s.school_id = $2`,
      [quarterId, req.user.schoolId]
    );

    const valuesByStudent = {};
    valuesResult.rows.forEach(v => {
      if (!valuesByStudent[v.student_id]) valuesByStudent[v.student_id] = {};
      valuesByStudent[v.student_id][v.core_value] = v.rating;
    });

    res.json(students.rows.map(s => ({
      ...s,
      values: valuesByStudent[s.id] || {}
    })));

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7l. SAVE REMARKS for a student/quarter
app.put('/api/admin/remarks/:studentId/:quarterId', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { studentId, quarterId } = req.params;
  const { body } = req.body;

  try {
    const studentCheck = await client.query(
      'SELECT id FROM students WHERE id = $1 AND school_id = $2',
      [studentId, req.user.schoolId]
    );
    if (studentCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    await client.query(
      `INSERT INTO remarks (student_id, quarter_id, body)
       VALUES ($1, $2, $3)
       ON CONFLICT (student_id, quarter_id) DO UPDATE SET body = $3`,
      [studentId, quarterId, body]
    );

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7m. SAVE CORE VALUES RATINGS for a student/quarter (all 4 at once)
app.put('/api/admin/values/:studentId/:quarterId', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { studentId, quarterId } = req.params;
  const { values } = req.body; // { 'Maka-Diyos': 'AO', ... }

  try {
    const studentCheck = await client.query(
      'SELECT id FROM students WHERE id = $1 AND school_id = $2',
      [studentId, req.user.schoolId]
    );
    if (studentCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    for (const [coreValue, rating] of Object.entries(values || {})) {
      await client.query(
        `INSERT INTO values_ratings (student_id, quarter_id, core_value, rating)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (student_id, quarter_id, core_value) DO UPDATE SET rating = $4`,
        [studentId, quarterId, coreValue, rating]
      );
    }

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== SCHOOL SETTINGS (Admin only) ====================

// 7n. GET SCHOOL INFO
app.get('/api/admin/school', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const result = await client.query(
      'SELECT id, name, address, director, registrar FROM schools WHERE id = $1',
      [req.user.schoolId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'School not found' });
    }

    res.json(result.rows[0]);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7o. UPDATE SCHOOL INFO
app.patch('/api/admin/school', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { name, address, director, registrar } = req.body;

  try {
    const result = await client.query(
      `UPDATE schools
       SET name = COALESCE($1, name), address = COALESCE($2, address),
           director = COALESCE($3, director), registrar = COALESCE($4, registrar)
       WHERE id = $5
       RETURNING id, name, address, director, registrar`,
      [name, address, director, registrar, req.user.schoolId]
    );

    res.json({ success: true, school: result.rows[0] });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7o2. SAVE BRANDING (logo, banner, colors, display name) - Admin only
app.patch('/api/admin/branding', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { displayName, primaryColor, accentColor, adminTagline, parentTagline, logo, banner, removeLogo, removeBanner } = req.body;

  if (primaryColor && !HEX_COLOR_RE.test(primaryColor)) {
    return res.status(400).json({ error: 'Invalid primary color' });
  }
  if (accentColor && !HEX_COLOR_RE.test(accentColor)) {
    return res.status(400).json({ error: 'Invalid accent color' });
  }

  try {
    const updates = ['branding_updated_at = NOW()'];
    const params = [];

    if (displayName !== undefined) {
      params.push(displayName);
      updates.push(`display_name = $${params.length}`);
    }
    if (primaryColor) {
      params.push(primaryColor);
      updates.push(`primary_color = $${params.length}`);
    }
    if (accentColor) {
      params.push(accentColor);
      updates.push(`accent_color = $${params.length}`);
    }
    if (adminTagline !== undefined) {
      params.push(adminTagline);
      updates.push(`admin_portal_tagline = $${params.length}`);
    }
    if (parentTagline !== undefined) {
      params.push(parentTagline);
      updates.push(`parent_portal_tagline = $${params.length}`);
    }

    if (removeLogo) {
      updates.push('logo = NULL', 'logo_content_type = NULL');
    } else if (logo && logo.data) {
      const buffer = Buffer.from(logo.data, 'base64');
      if (buffer.length > 2 * 1024 * 1024) {
        return res.status(400).json({ error: 'Logo must be 2MB or smaller' });
      }
      const detectedType = detectImageType(buffer);
      if (!detectedType) {
        return res.status(400).json({ error: 'Logo must be a PNG, JPEG, or WebP image' });
      }
      const resized = await resizeImage(buffer, 512, 512);
      params.push(resized);
      updates.push(`logo = $${params.length}`);
      params.push(`image/${detectedType}`);
      updates.push(`logo_content_type = $${params.length}`);
    }

    if (removeBanner) {
      updates.push('banner = NULL', 'banner_content_type = NULL');
    } else if (banner && banner.data) {
      const buffer = Buffer.from(banner.data, 'base64');
      if (buffer.length > 4 * 1024 * 1024) {
        return res.status(400).json({ error: 'Banner must be 4MB or smaller' });
      }
      const detectedType = detectImageType(buffer);
      if (!detectedType) {
        return res.status(400).json({ error: 'Banner must be a PNG, JPEG, or WebP image' });
      }
      const resized = await resizeImage(buffer, 1600, 400);
      params.push(resized);
      updates.push(`banner = $${params.length}`);
      params.push(`image/${detectedType}`);
      updates.push(`banner_content_type = $${params.length}`);
    }

    params.push(req.user.schoolId);

    const result = await client.query(
      `UPDATE schools SET ${updates.join(', ')}
       WHERE id = $${params.length}
       RETURNING display_name, primary_color, accent_color,
                 admin_portal_tagline, parent_portal_tagline,
                 (logo IS NOT NULL) AS "hasLogo", (banner IS NOT NULL) AS "hasBanner",
                 branding_updated_at`,
      params
    );

    res.json({ success: true, branding: result.rows[0] });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7p. CYCLE/SET A QUARTER'S STATUS
app.patch('/api/admin/quarters/:quarterId', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { quarterId } = req.params;
  const { status } = req.body;

  if (!['not_started', 'in_progress', 'released'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    const result = await client.query(
      `UPDATE quarters SET status = $1
       WHERE id = $2 AND school_id = $3
       RETURNING id, school_year, label, short, sort_order, status`,
      [status, quarterId, req.user.schoolId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Quarter not found' });
    }

    res.json({ success: true, quarter: result.rows[0] });

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
  const schoolYear = req.body.schoolYear || '2026-2027';

  try {
    // Quarters are real rows now - resolve this school's Q1-Q4 ids for the
    // given school_year, then upsert one row per non-null quarter score.
    const quartersResult = await client.query(
      `SELECT id, sort_order FROM quarters WHERE school_id = $1 AND school_year = $2`,
      [req.user.schoolId, schoolYear]
    );

    const quarterIdByOrder = {};
    quartersResult.rows.forEach(q => { quarterIdByOrder[q.sort_order] = q.id; });

    const scoreByOrder = { 1: q1, 2: q2, 3: q3, 4: q4 };
    const saved = { subject };

    for (const order of [1, 2, 3, 4]) {
      const score = scoreByOrder[order];
      const quarterId = quarterIdByOrder[order];
      if (score === undefined || score === null || !quarterId) continue;

      await client.query(
        `INSERT INTO grades (student_id, quarter_id, subject_code, score)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (student_id, quarter_id, subject_code) DO UPDATE SET score = $4`,
        [studentId, quarterId, subject, score]
      );
      saved['q' + order] = score;
    }

    res.json({
      success: true,
      message: 'Grade saved successfully',
      grade: saved
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
  const schoolYear = req.body.schoolYear || '2026-2027';

  try {
    // CheckEd's data is month-based; the new admin portal's attendance is
    // quarter-based (see attendance table). There's no reliable month-to-
    // quarter mapping without a real school-calendar config, so CheckEd
    // sync keeps writing to the old month-based table (renamed, not
    // dropped, by the quarters migration) rather than guessing one.
    const existing = await client.query(
      'SELECT id FROM attendance_legacy WHERE student_id = $1 AND month = $2 AND school_year = $3',
      [studentId, month, schoolYear]
    );

    let result;
    if (existing.rows.length > 0) {
      result = await client.query(
        `UPDATE attendance_legacy
         SET present_days = $1, absent_days = $2, tardy_days = $3
         WHERE student_id = $4 AND month = $5 AND school_year = $6
         RETURNING student_id, month, present_days, absent_days, tardy_days`,
        [presentDays, absentDays, tardyDays, studentId, month, schoolYear]
      );
    } else {
      result = await client.query(
        `INSERT INTO attendance_legacy (student_id, month, present_days, absent_days, tardy_days, school_year)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING student_id, month, present_days, absent_days, tardy_days`,
        [studentId, month, presentDays, absentDays, tardyDays, schoolYear]
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
      const schoolYear = record.schoolYear || '2026-2027';
      await client.query(
        `INSERT INTO attendance_legacy (student_id, month, present_days, absent_days, tardy_days, school_year)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (student_id, month, school_year) DO UPDATE SET
         present_days = $3, absent_days = $4, tardy_days = $5`,
        [record.studentId, record.month, record.presentDays, record.absentDays, record.tardyDays, schoolYear]
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
  GET    /api/remarks-values/:studentId - Get remarks & core values
  GET    /api/announcements/:schoolId - Get announcements

Admin Only (requires token):
  GET    /api/admin/students       - List students
  POST   /api/admin/students       - Add student
  DELETE /api/admin/students/:id   - Delete student
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
