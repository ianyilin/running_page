import { Helmet } from 'react-helmet-async';

const NotFoundPage = () => {
  return (
    <>
      <Helmet>
        <title>RUN.LOG - Not Found</title>
      </Helmet>
      <main className="runlog-not-found">
        <h1>404</h1>
        <p>Page not found.</p>
        <a href="/">Back to RUN.LOG</a>
      </main>
    </>
  );
};

export default NotFoundPage;
