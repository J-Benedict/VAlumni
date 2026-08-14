-- VAlumni PostgreSQL Database Schema
-- Run this script in PostgreSQL (e.g. via psql or pgAdmin) to create the database and tables.

-- 1. Create Database (Run separately if needed)
-- CREATE DATABASE valumni_db;

-- Connect to valumni_db before running the table creation below:
-- \c valumni_db;

-- 2. Create Interviews Table
CREATE TABLE IF NOT EXISTS interview_transcripts (
    id VARCHAR(100) PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    source VARCHAR(50) DEFAULT 'voice_interview',
    student_id VARCHAR(50),
    name VARCHAR(255) NOT NULL,
    program VARCHAR(100),
    graduation_year VARCHAR(20),
    capstone_role VARCHAR(100),
    
    -- Numerical Ratings (1-5 scale)
    rate_core INTEGER DEFAULT 0,
    rate_electives INTEGER DEFAULT 0,
    rate_mentorship INTEGER DEFAULT 0,
    rate_internship INTEGER DEFAULT 0,
    rate_hardware INTEGER DEFAULT 0,
    rate_software INTEGER DEFAULT 0,
    rate_internet INTEGER DEFAULT 0,
    rate_lab_env INTEGER DEFAULT 0,
    overall_avg NUMERIC(3,2) DEFAULT 0.0,
    
    -- Qualitative Responses
    useful_tech TEXT,
    desired_tech TEXT,
    grievance TEXT,
    employment_status VARCHAR(100),
    confidence VARCHAR(100),
    guest_speaker VARCHAR(100),
    breakthrough TEXT,
    restructure_suggestion TEXT,
    legacy_tip TEXT,
    
    -- Sentiment Analysis
    sentiment_label VARCHAR(20) DEFAULT 'Neutral',
    sentiment_score NUMERIC(3,2) DEFAULT 0.50,
    
    -- Raw JSONB for flexibility & future dynamic questions
    raw_responses JSONB,
    
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance & quick queries in dashboard analytics
CREATE INDEX IF NOT EXISTS idx_transcripts_student_id ON interview_transcripts(student_id);
CREATE INDEX IF NOT EXISTS idx_transcripts_program ON interview_transcripts(program);
CREATE INDEX IF NOT EXISTS idx_transcripts_timestamp ON interview_transcripts(timestamp DESC);
