import https from 'https';

const fetchOpenRouter = () => {
  return new Promise((resolve, reject) => {
    https.get('https://openrouter.ai/api/v1/models', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
};

(async () => {
    try {
        const or = await fetchOpenRouter();
        const models = or.data.map(m => m.id);
        
        const filterPrint = (prefix) => {
            console.log(`\n### ${prefix} ###`);
            console.log(models.filter(m => m.startsWith(prefix)).slice(0, 20).join('\n'));
        }
        
        filterPrint('openai/');
        filterPrint('google/');
        filterPrint('anthropic/');
        filterPrint('meta-llama/');
        filterPrint('mistralai/');
        filterPrint('qwen/');
        filterPrint('x-ai/');
        filterPrint('deepseek/');
        
    } catch(e) { console.error(e); }
})();
