(self.webpackChunkdlt_logs=self.webpackChunkdlt_logs||[]).push([[155],{3905:function(e,r,t){"use strict";t.d(r,{Zo:function(){return u},kt:function(){return d}});var n=t(7294);function l(e,r,t){return r in e?Object.defineProperty(e,r,{value:t,enumerable:!0,configurable:!0,writable:!0}):e[r]=t,e}function o(e,r){var t=Object.keys(e);if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e);r&&(n=n.filter((function(r){return Object.getOwnPropertyDescriptor(e,r).enumerable}))),t.push.apply(t,n)}return t}function i(e){for(var r=1;r<arguments.length;r++){var t=null!=arguments[r]?arguments[r]:{};r%2?o(Object(t),!0).forEach((function(r){l(e,r,t[r])})):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(t)):o(Object(t)).forEach((function(r){Object.defineProperty(e,r,Object.getOwnPropertyDescriptor(t,r))}))}return e}function a(e,r){if(null==e)return{};var t,n,l=function(e,r){if(null==e)return{};var t,n,l={},o=Object.keys(e);for(n=0;n<o.length;n++)t=o[n],r.indexOf(t)>=0||(l[t]=e[t]);return l}(e,r);if(Object.getOwnPropertySymbols){var o=Object.getOwnPropertySymbols(e);for(n=0;n<o.length;n++)t=o[n],r.indexOf(t)>=0||Object.prototype.propertyIsEnumerable.call(e,t)&&(l[t]=e[t])}return l}var s=n.createContext({}),f=function(e){var r=n.useContext(s),t=r;return e&&(t="function"==typeof e?e(r):i(i({},r),e)),t},u=function(e){var r=f(e.components);return n.createElement(s.Provider,{value:r},e.children)},c={inlineCode:"code",wrapper:function(e){var r=e.children;return n.createElement(n.Fragment,{},r)}},p=n.forwardRef((function(e,r){var t=e.components,l=e.mdxType,o=e.originalType,s=e.parentName,u=a(e,["components","mdxType","originalType","parentName"]),p=f(t),d=l,g=p["".concat(s,".").concat(d)]||p[d]||c[d]||o;return t?n.createElement(g,i(i({ref:r},u),{},{components:t})):n.createElement(g,i({ref:r},u))}));function d(e,r){var t=arguments,l=r&&r.mdxType;if("string"==typeof e||l){var o=t.length,i=new Array(o);i[0]=p;var a={};for(var s in r)hasOwnProperty.call(r,s)&&(a[s]=r[s]);a.originalType=e,a.mdxType="string"==typeof e?e:l,i[1]=a;for(var f=2;f<o;f++)i[f]=t[f];return n.createElement.apply(null,i)}return n.createElement.apply(null,t)}p.displayName="MDXCreateElement"},8036:function(e,r,t){"use strict";t.r(r),t.d(r,{frontMatter:function(){return i},metadata:function(){return a},toc:function(){return s},default:function(){return u}});var n=t(2122),l=t(9756),o=(t(7294),t(3905)),i={id:"fileTransfer",title:"File transfer plugin",sidebar_label:"Plugin File Transfer"},a={unversionedId:"fileTransfer",id:"fileTransfer",isDocsHomePage:!1,title:"File transfer plugin",description:"The file transfer plugin is enabled by default.",source:"@site/docs/fileTransfer.md",sourceDirName:".",slug:"/fileTransfer",permalink:"/dlt-logs/docs/fileTransfer",editUrl:"https://github.com/mbehr1/dlt-logs/edit/master/docs/dlt-logs/docs/fileTransfer.md",version:"current",sidebar_label:"Plugin File Transfer",frontMatter:{id:"fileTransfer",title:"File transfer plugin",sidebar_label:"Plugin File Transfer"},sidebar:"dltLogsSideBar",previous:{title:"Export and filter DLT files",permalink:"/dlt-logs/docs/exportAndFilter"},next:{title:"SOME/IP decoder plugin",permalink:"/dlt-logs/docs/someIpPlugin"}},s=[],f={toc:s};function u(e){var r=e.components,t=(0,l.Z)(e,["components"]);return(0,o.kt)("wrapper",(0,n.Z)({},f,t,{components:r,mdxType:"MDXLayout"}),(0,o.kt)("p",null,"The file transfer plugin is enabled by default."),(0,o.kt)("p",null,"The following options can be configured:"),(0,o.kt)("pre",null,(0,o.kt)("code",{parentName:"pre",className:"language-jsonc"},'"dlt-logs.plugins": [\n    {\n        "name": "FileTransfer",\n        "enabled": true, // whether the plugin is enabled. Defaults to true.\n        "allowSave": true, // whether the plugin shall allow saving the files. If you set this to false less memory will be used. You\'ll still be able to see the files and but not save them.\n        "keepFLDA": false, // whether the FLDA messages shall be kept in the log. By default they are removed.\n        "apid": "SYS", // the APID to search for file transfer messages\n        "ctid": "FILE" // the CTID to search for file transfer messages\n    },\n    {\n        "name":"SomeIp", // configuration for SOME/IP plugin...\n        ...\n    }\n]\n')))}u.isMDXComponent=!0}}]);