# MSG Viewer browser demo

The viewer parses a selected Outlook `.msg` in the browser. It uses the library source and bundles browser adapters for its in-memory code path. The demo dependencies are installed separately from the npm package.

```sh
npm ci --prefix demo
npm --prefix demo test
npm --prefix demo run build
npx serve demo/dist --listen tcp://127.0.0.1:4174
```

Open [the local viewer](http://127.0.0.1:4174/) and select or drop a .msg file up to 100 MiB.

For GitHub Pages, publish the contents of `demo/dist`. The build uses relative asset URLs so it can be served under the repository path.
