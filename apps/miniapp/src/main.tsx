import './instrument'; // must be first — initialises Sentry before any app code

import { TDSMobileAITProvider } from '@toss/tds-mobile-ait';
import * as Sentry from '@sentry/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import config from '../granite.config';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary
      fallback={<p style={{ padding: 24 }}>문제가 발생했어요. 잠시 후 다시 시도해 주세요.</p>}
    >
      <TDSMobileAITProvider brandPrimaryColor={config.brand.primaryColor}>
        <App />
      </TDSMobileAITProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>
);
