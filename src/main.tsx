import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import Index from './pages';
import NotFound from './pages/404';
import '@/styles/index.css';

const routes = createBrowserRouter(
  [
    {
      path: '/',
      element: <Index />,
    },
    {
      path: 'routes',
      element: <Index />,
    },
    {
      path: 'heatmap',
      element: <Index />,
    },
    {
      path: 'running_life',
      element: <Index />,
    },
    {
      path: 'mls',
      element: <Index />,
    },
    {
      path: 'mls/:id',
      element: <Index />,
    },
    {
      path: '*',
      element: <NotFound />,
    },
  ],
  { basename: import.meta.env.BASE_URL }
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HelmetProvider>
      <RouterProvider router={routes} />
    </HelmetProvider>
  </React.StrictMode>
);
