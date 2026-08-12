import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import GuardDemo from './GuardDemo';
import './guard.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GuardDemo />
  </StrictMode>
);
