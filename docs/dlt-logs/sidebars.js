module.exports = {
  dltLogsSideBar: {
    'DLT-Logs': [
      {
        type: 'category',
        label: 'Guides',
        items: ['installFirstUse', 'genericSettings', 'filterReference', 'configsReference'],
      },
      {
        type: 'category',
        label: 'Features',
        items: [
          'lifecycleDetection',
          'toggleSortOrder',
          'searchPanel',
          'reports',
          'exportAndFilter',
          'fileTransfer',
          'someIpPlugin',
          'canPlugin',
          'nonVerbosePlugin',
          'rewritePlugin',
        ],
        collapsed: false,
      },
      {
        type: 'link',
        label: 'Changelog',
        href: 'https://github.com/mbehr1/dlt-logs/blob/master/CHANGELOG.md',
      },
    ],
  },
}
