import { describe, it, expect } from 'vitest';
import { scanAndRedact, hasSensitiveInfo } from '../../src/core/privacy.js';

describe('scanAndRedact', () => {
  describe('clean content', () => {
    it('returns found=false and preserves content with no secrets', () => {
      const text = 'This is a normal memory entry without any secrets.';
      const result = scanAndRedact(text);
      expect(result.found).toBe(false);
      expect(result.redacted_content).toBe(text);
      expect(result.detections).toEqual([]);
    });

    it('handles empty string', () => {
      const result = scanAndRedact('');
      expect(result.found).toBe(false);
      expect(result.redacted_content).toBe('');
    });
  });

  describe('API keys', () => {
    it('redacts OpenAI API key', () => {
      const text = 'My key is sk-proj1234567890abcdefghijklmn in the config.';
      const result = scanAndRedact(text);
      expect(result.found).toBe(true);
      expect(result.redacted_content).toContain('sk-***REDACTED***');
      expect(result.redacted_content).not.toContain('sk-proj1234567890abcdefghijklmn');
      expect(result.detections).toContainEqual({ name: 'OpenAI API Key', count: 1 });
    });

    it('redacts Anthropic API key', () => {
      const text = 'sk-ant-api03-abcDEF123456789-xyz-longkey';
      const result = scanAndRedact(text);
      expect(result.found).toBe(true);
      expect(result.redacted_content).toContain('sk-ant-***REDACTED***');
    });

    it('redacts GitHub classic token', () => {
      const text = 'token: ghp_abcdefghijklmnopqrstuvwxyz0123456789';
      const result = scanAndRedact(text);
      expect(result.found).toBe(true);
      expect(result.redacted_content).toContain('ghp_***REDACTED***');
    });

    it('redacts GitHub fine-grained token', () => {
      const text = 'github_pat_11ABCDEFG0abcdefghij_xyz1234567890';
      const result = scanAndRedact(text);
      expect(result.found).toBe(true);
      expect(result.redacted_content).toContain('github_pat_***REDACTED***');
    });

    it('redacts AWS access key', () => {
      const text = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
      const result = scanAndRedact(text);
      expect(result.found).toBe(true);
      expect(result.redacted_content).toContain('AKIA***REDACTED***');
    });

    it('redacts AWS secret key assignment', () => {
      const text = 'aws_secret_access_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"';
      const result = scanAndRedact(text);
      expect(result.found).toBe(true);
      expect(result.redacted_content).toContain('***AWS_SECRET_REDACTED***');
    });

    it('redacts generic api_key assignment', () => {
      const text = 'api_key: "abc123def456ghi789jkl"';
      const result = scanAndRedact(text);
      expect(result.found).toBe(true);
      expect(result.redacted_content).toContain('***API_KEY_REDACTED***');
    });

    it('redacts Google Cloud API key', () => {
      const text = 'key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI';
      const result = scanAndRedact(text);
      expect(result.found).toBe(true);
      expect(result.redacted_content).toContain('***GOOGLE_KEY_REDACTED***');
    });

    it('redacts Slack token', () => {
      const text = 'Slack: xoxb-1234567890-abcdefghij-XXXXXXXXXXX';
      const result = scanAndRedact(text);
      expect(result.found).toBe(true);
      expect(result.redacted_content).toContain('***SLACK_TOKEN_REDACTED***');
    });

    it('redacts Telegram bot token', () => {
      // Telegram token format: <8-10 digit bot_id>:<35-char secret>
      const text = 'Bot: 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaww';
      const result = scanAndRedact(text);
      expect(result.found).toBe(true);
      expect(result.redacted_content).toContain('***TELEGRAM_TOKEN_REDACTED***');
    });
  });

  describe('auth tokens', () => {
    it('redacts Bearer token', () => {
      const text = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
      const result = scanAndRedact(text);
      expect(result.found).toBe(true);
      // Either Bearer Token or Authorization Header pattern handles it
      expect(result.redacted_content).toMatch(/(Bearer \*\*\*REDACTED\*\*\*|Authorization: \*\*\*REDACTED\*\*\*)/);
    });

    it('redacts Authorization header with Basic auth', () => {
      const text = 'Authorization: Basic dXNlcjpwYXNzd29yZDEyMzQ=';
      const result = scanAndRedact(text);
      expect(result.found).toBe(true);
      expect(result.redacted_content).toContain('Authorization: ***REDACTED***');
    });

    it('redacts custom API headers (X-API-Key)', () => {
      const text = 'X-API-Key: abcdefghij1234567890';
      const result = scanAndRedact(text);
      expect(result.found).toBe(true);
      expect(result.redacted_content).toContain('***CUSTOM_HEADER_REDACTED***');
    });

    it('redacts X-Auth-Token style headers', () => {
      const text = 'X-Auth-Token: verylongsecrettoken1234567';
      const result = scanAndRedact(text);
      expect(result.found).toBe(true);
      expect(result.redacted_content).toContain('***CUSTOM_HEADER_REDACTED***');
    });

    it('redacts password assignment', () => {
      const text = 'password: "supersecret123"';
      const result = scanAndRedact(text);
      expect(result.found).toBe(true);
      expect(result.redacted_content).toContain('***PASSWORD_REDACTED***');
    });
  });

  describe('database connection strings', () => {
    it('redacts postgresql:// connection strings with creds', () => {
      const text = 'postgresql://admin:supersecret@db.example.com:5432/mydb';
      const result = scanAndRedact(text);
      expect(result.found).toBe(true);
      expect(result.redacted_content).toContain('***DB_CONNECTION_REDACTED***');
      expect(result.redacted_content).not.toContain('supersecret');
    });

    it('redacts mysql:// connections', () => {
      const text = 'mysql://user:pw@host/db';
      const result = scanAndRedact(text);
      expect(result.found).toBe(true);
      expect(result.redacted_content).toContain('***DB_CONNECTION_REDACTED***');
    });

    it('redacts mongodb+srv:// connections', () => {
      const text = 'mongodb+srv://admin:secret@cluster.mongodb.net/db';
      const result = scanAndRedact(text);
      expect(result.found).toBe(true);
      expect(result.redacted_content).toContain('***DB_CONNECTION_REDACTED***');
    });

    it('does NOT redact connection strings without credentials', () => {
      const text = 'postgresql://host:5432/db';
      const result = scanAndRedact(text);
      // No user:password@ portion, should pass through
      expect(result.redacted_content).toContain('postgresql://host');
    });
  });

  describe('keys and identifiers', () => {
    it('redacts SSH private key header', () => {
      const text = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKC...';
      const result = scanAndRedact(text);
      expect(result.found).toBe(true);
      expect(result.redacted_content).toContain('***SSH_KEY_REDACTED***');
      expect(result.redacted_content).not.toContain('BEGIN RSA PRIVATE KEY');
    });

    it('redacts SSH private key of various types', () => {
      for (const header of [
        '-----BEGIN PRIVATE KEY-----',
        '-----BEGIN OPENSSH PRIVATE KEY-----',
        '-----BEGIN EC PRIVATE KEY-----',
        '-----BEGIN DSA PRIVATE KEY-----',
      ]) {
        const result = scanAndRedact(header);
        expect(result.found).toBe(true);
        expect(result.redacted_content).toContain('***SSH_KEY_REDACTED***');
      }
    });
  });

  describe('private IP addresses', () => {
    it('redacts 10.x.x.x', () => {
      expect(scanAndRedact('Server at 10.0.0.1 is down.').redacted_content)
        .toContain('***PRIVATE_IP***');
    });

    it('redacts 192.168.x.x', () => {
      expect(scanAndRedact('Router: 192.168.1.1').redacted_content)
        .toContain('***PRIVATE_IP***');
    });

    it('redacts 172.16.x.x through 172.31.x.x', () => {
      expect(scanAndRedact('Internal 172.16.5.10 and 172.31.255.255').redacted_content)
        .toContain('***PRIVATE_IP***');
    });

    it('does NOT redact public IPs like 8.8.8.8', () => {
      const result = scanAndRedact('DNS: 8.8.8.8');
      expect(result.redacted_content).toContain('8.8.8.8');
    });

    it('does NOT redact 172.15.x.x or 172.32.x.x (out of private range)', () => {
      const result = scanAndRedact('IP 172.15.1.1 and 172.32.0.1');
      expect(result.redacted_content).toContain('172.15.1.1');
      expect(result.redacted_content).toContain('172.32.0.1');
    });
  });

  describe('email addresses', () => {
    it('redacts simple email', () => {
      const result = scanAndRedact('Contact me at user@example.com');
      expect(result.redacted_content).toContain('***EMAIL_REDACTED***');
      expect(result.redacted_content).not.toContain('user@example.com');
    });

    it('redacts multiple emails in a single call', () => {
      const result = scanAndRedact('alice@foo.com and bob@bar.org');
      const match = result.detections.find(d => d.name === 'Email Address');
      expect(match?.count).toBe(2);
    });

    it('does not match invalid email-like strings', () => {
      const result = scanAndRedact('foo@bar (no TLD) and @mention');
      expect(result.found).toBe(false);
    });
  });

  describe('multiple secrets in one input', () => {
    it('detects and redacts multiple distinct patterns', () => {
      const text = `
config:
  api_key: "abcdefghij1234567890"
  email: admin@company.com
  server: 192.168.1.100
      `;
      const result = scanAndRedact(text);
      expect(result.found).toBe(true);
      expect(result.detections.length).toBeGreaterThanOrEqual(3);
      expect(result.redacted_content).toContain('***API_KEY_REDACTED***');
      expect(result.redacted_content).toContain('***EMAIL_REDACTED***');
      expect(result.redacted_content).toContain('***PRIVATE_IP***');
    });

    it('counts duplicates of the same pattern', () => {
      const text = 'Emails: a@x.com, b@x.com, c@x.com';
      const result = scanAndRedact(text);
      const emailDetection = result.detections.find(d => d.name === 'Email Address');
      expect(emailDetection?.count).toBe(3);
    });
  });

  describe('stateful regex safety (lastIndex regression)', () => {
    it('returns consistent results across repeated calls with same input', () => {
      const text = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
      const r1 = scanAndRedact(text);
      const r2 = scanAndRedact(text);
      const r3 = scanAndRedact(text);
      expect(r1.redacted_content).toBe(r2.redacted_content);
      expect(r2.redacted_content).toBe(r3.redacted_content);
      expect(r1.found).toBe(true);
      expect(r2.found).toBe(true);
      expect(r3.found).toBe(true);
    });

    it('detects across independent calls (regex lastIndex not shared)', () => {
      // Known pitfall: /g regex .test() retains lastIndex across calls.
      // getPatterns() must return fresh instances each call.
      const text = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
      for (let i = 0; i < 5; i++) {
        expect(scanAndRedact(text).found).toBe(true);
      }
    });
  });
});

describe('hasSensitiveInfo', () => {
  it('returns true when content contains a secret', () => {
    expect(hasSensitiveInfo('api_key: "verylongsecretvalue1234"')).toBe(true);
    expect(hasSensitiveInfo('password: "mypass1234"')).toBe(true);
    expect(hasSensitiveInfo('ghp_abcdefghijklmnopqrstuvwxyz0123456789')).toBe(true);
  });

  it('returns false for clean content', () => {
    expect(hasSensitiveInfo('hello world')).toBe(false);
    expect(hasSensitiveInfo('')).toBe(false);
    expect(hasSensitiveInfo('normal markdown with no secrets')).toBe(false);
  });

  it('is stable across repeated calls (no lastIndex leak)', () => {
    const text = 'user@example.com';
    for (let i = 0; i < 10; i++) {
      expect(hasSensitiveInfo(text)).toBe(true);
    }
  });

  it('returns false after a successful match on a different input', () => {
    // Regression guard: calling with a matching input first, then a clean one,
    // should not leave the regex in a state that causes false negatives.
    expect(hasSensitiveInfo('user@example.com')).toBe(true);
    expect(hasSensitiveInfo('plain text')).toBe(false);
    expect(hasSensitiveInfo('another@test.com')).toBe(true);
  });
});
