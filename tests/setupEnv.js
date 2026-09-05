process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@localhost:5432/personal_agent_test?schema=public';
process.env.REDIS_URL ||= 'redis://localhost:6379';
process.env.OLLAMA_BASE_URL ||= 'http://localhost:11434';
