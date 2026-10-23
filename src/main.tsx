import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { configureParserWorker } from './services/parserWorkerClient'

configureParserWorker(() => new Worker(new URL('./services/playlistParser.worker.ts', import.meta.url), { type: 'module' }))

createRoot(document.getElementById('root')!).render(
  <App />,
)
