module.exports = {
  title: 'dlt-logs Visual Studio Code Extension',
  tagline: 'Work with DLT files in VS Code',
  url: 'https://mbehr1.github.io',
  baseUrl: '/dlt-logs/',
  onBrokenLinks: 'throw',
  favicon: 'img/favicon.ico',
  organizationName: 'mbehr1', // Usually your GitHub org/user name.
  projectName: 'dlt-logs', // Usually your repo name.
  // plugins: ['@docusaurus/plugin-google-analytics'],
  themeConfig: {
    googleAnalytics: {
      trackingID: 'UA-180286216-1',
    },
    navbar: {
      title: 'dlt-logs',
      logo: {
        alt: 'dlt-logs logo',
        src: 'img/logs.svg', // todo improve color...
      },
      items: [
        {
          to: 'docs/',
          activeBasePath: 'docs',
          label: 'Docs',
          position: 'left',
        },
        { to: 'blog', label: 'Blog', position: 'left' },
        {
          href: 'https://github.com/mbehr1/dlt-logs',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Reports',
              to: 'docs/reports/',
            },
            //{
            //  label: 'Second Doc',
            //  to: 'docs/doc2/',
            //},
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'Stack Overflow',
              href: 'https://stackoverflow.com/questions/tagged/dlt-logs',
            },
            {
              label: 'Twitter',
              href: 'https://twitter.com/freeddoo',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'Blog',
              to: 'blog',
            },
            {
              label: 'GitHub dlt-logs',
              href: 'https://github.com/mbehr1/dlt-logs',
            },
            {
              label: 'vsc-webshark',
              href: 'https://github.com/mbehr1/vsc-webshark',
            },
            {
              label: 'smart-log',
              href: 'https://github.com/mbehr1/smart-log',
            },

          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear() > 2020 ? `2020 - ${new Date().getFullYear()}` : new Date().getFullYear()} Matthias Behr. Docs built with Docusaurus.`,
    },
  },
  presets: [
    [
      '@docusaurus/preset-classic',
      {
        docs: {
          sidebarPath: require.resolve('./sidebars.js'),
          // Please change this to your repo.
          editUrl:
            'https://github.com/mbehr1/dlt-logs/edit/master/docs/dlt-logs/',
        },
        blog: {
          showReadingTime: true,
          // Please change this to your repo.
          editUrl:
            'https://github.com/mbehr1/dlt-logs/edit/master/docs/dlt-logs/',
        },
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
        //googleAnalytics: {
        //  trackingID: 'UA-180286216-1'
        //},
      },
    ],
  ],
};
