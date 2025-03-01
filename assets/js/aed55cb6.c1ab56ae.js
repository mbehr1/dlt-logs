"use strict";(self.webpackChunkdlt_logs=self.webpackChunkdlt_logs||[]).push([[948],{9048:(e,n,t)=>{t.r(n),t.d(n,{assets:()=>c,contentTitle:()=>d,default:()=>h,frontMatter:()=>l,metadata:()=>o,toc:()=>a});var i=t(4848),s=t(8453);const l={id:"configsReference",title:"dlt-logs.configs reference",sidebar_label:"Configs"},d=void 0,o={id:"configsReference",title:"dlt-logs.configs reference",description:"Overview",source:"@site/docs/configsReference.md",sourceDirName:".",slug:"/configsReference",permalink:"/dlt-logs/docs/configsReference",draft:!1,unlisted:!1,editUrl:"https://github.com/mbehr1/dlt-logs/edit/master/docs/dlt-logs/docs/configsReference.md",tags:[],version:"current",frontMatter:{id:"configsReference",title:"dlt-logs.configs reference",sidebar_label:"Configs"},sidebar:"dltLogsSideBar",previous:{title:"Filter reference",permalink:"/dlt-logs/docs/filterReference"},next:{title:"Lifecycle detection",permalink:"/dlt-logs/docs/lifecycleDetection"}},c={},a=[{value:"Overview",id:"overview",level:2},{value:"Details",id:"details",level:2},{value:"Config attributes",id:"config-attributes",level:3},{value:"Example",id:"example",level:4},{value:"Assign/add filters to a config",id:"assignadd-filters-to-a-config",level:3}];function r(e){const n={a:"a",admonition:"admonition",code:"code",h2:"h2",h3:"h3",h4:"h4",p:"p",pre:"pre",table:"table",tbody:"tbody",td:"td",th:"th",thead:"thead",tr:"tr",...(0,s.R)(),...e.components};return(0,i.jsxs)(i.Fragment,{children:[(0,i.jsx)(n.h2,{id:"overview",children:"Overview"}),"\n",(0,i.jsx)(n.p,{children:"Configs allow to bundle a set of filters to ease the analysis of specific problems."}),"\n",(0,i.jsx)(n.p,{children:"E.g. you can bundle all filters related to flash problems and then enable/disable all those filters quickly together from the logs tree view."}),"\n",(0,i.jsx)(n.h2,{id:"details",children:"Details"}),"\n",(0,i.jsx)(n.h3,{id:"config-attributes",children:"Config attributes"}),"\n",(0,i.jsx)(n.p,{children:"Configs consist of the following attributes:"}),"\n",(0,i.jsxs)(n.table,{children:[(0,i.jsx)(n.thead,{children:(0,i.jsxs)(n.tr,{children:[(0,i.jsx)(n.th,{children:"attribute name"}),(0,i.jsx)(n.th,{children:"expected type"}),(0,i.jsx)(n.th,{children:"default value"}),(0,i.jsx)(n.th,{children:"description"})]})}),(0,i.jsxs)(n.tbody,{children:[(0,i.jsxs)(n.tr,{children:[(0,i.jsx)(n.td,{children:(0,i.jsx)(n.code,{children:"name"})}),(0,i.jsx)(n.td,{children:"string"}),(0,i.jsx)(n.td,{children:"mandatory, so no default"}),(0,i.jsxs)(n.td,{children:["Name for the config. Cannot contain the ",(0,i.jsx)(n.code,{children:"/"})," character. Configs are automatically nested by the ",(0,i.jsx)(n.code,{children:"/"})," character. E.g. a name/path of ",(0,i.jsx)(n.code,{children:"foo/bar"})," defines a config named ",(0,i.jsx)(n.code,{children:"foo"})," with a child config named ",(0,i.jsx)(n.code,{children:"bar"}),"."]})]}),(0,i.jsxs)(n.tr,{children:[(0,i.jsx)(n.td,{children:(0,i.jsx)(n.code,{children:"autoEnableIf"})}),(0,i.jsx)(n.td,{children:"string"}),(0,i.jsx)(n.td,{children:"-"}),(0,i.jsxs)(n.td,{children:["Optional regular expression that is applied on the ECU name. E.g. ",(0,i.jsx)(n.code,{children:"ECU1|ECU2"}),". If a log file is opened the config is automatically enabled if the ECU name from contained logs matches this regex."]})]})]})]}),"\n",(0,i.jsx)(n.h4,{id:"example",children:"Example"}),"\n",(0,i.jsxs)(n.p,{children:["E.g. the following settings define one config named ",(0,i.jsx)(n.code,{children:"Linux"})," that gets automatically enabled i.e. all filters ",(0,i.jsx)(n.a,{href:"#assignadd-filters-to-a-config",children:"assigned"})," to it are automatically enabled.\nAnd it defines a 2nd and 3rd config named ",(0,i.jsx)(n.code,{children:"RTOS"})," with a child config named ",(0,i.jsx)(n.code,{children:"Schedule"})," that are not automatically enabled."]}),"\n",(0,i.jsx)(n.pre,{children:(0,i.jsx)(n.code,{className:"language-jsonc",metastring:"{1,3,4,7}",children:'"dlt-logs.configs":[\n  {\n    "name":"Linux",\n    "autoEnableIf":"LX1|ECU2" // auto enable for ecu LX1 or ECU2\n  },\n  {\n    "name":"RTOS/Schedule",\n  },\n]\n'})}),"\n",(0,i.jsx)(n.admonition,{title:"Filters assigned are automatically disabled",type:"note",children:(0,i.jsx)(n.p,{children:"After loading a file all filters assigned to a config get automatically disabled!"})}),"\n",(0,i.jsx)(n.admonition,{title:"Configs in tree view",type:"note",children:(0,i.jsxs)(n.p,{children:["See the ",(0,i.jsx)(n.code,{children:"Configs"})," section in the tree view to quickly enable/disable all filters assigned to that config."]})}),"\n",(0,i.jsx)(n.admonition,{title:"Child configs",type:"note",children:(0,i.jsxs)(n.p,{children:["Child configs (those created by ",(0,i.jsx)(n.code,{children:"/"}),") are enabled/disabled as well if their parent config gets enabled/disabled."]})}),"\n",(0,i.jsx)(n.h3,{id:"assignadd-filters-to-a-config",children:"Assign/add filters to a config"}),"\n",(0,i.jsxs)(n.p,{children:["To add a filter to a config you do need to add the config name/path to the ",(0,i.jsx)(n.code,{children:"configs"})," array attribute of the filter. E.g."]}),"\n",(0,i.jsx)(n.pre,{children:(0,i.jsx)(n.code,{className:"language-jsonc",metastring:"{6}",children:'"dlt-logs.filters":[\n  {\n    "type":0, // pos. filter\n    "apid":"SYS",\n    "ctid":"JOUR",\n    "configs":["Linux/System"]\n  },\n  ... // other filters\n]\n'})}),"\n",(0,i.jsxs)(n.p,{children:["This adds the filter with ",(0,i.jsx)(n.code,{children:"apid/ctid: SYS/JOUR"})," to the config ",(0,i.jsx)(n.code,{children:"System"})," which is a child of the linux ",(0,i.jsx)(n.code,{children:"Linux"})," config. The ",(0,i.jsx)(n.code,{children:"Linux"})," config from the upper example gets automatically enabled if logs from ",(0,i.jsx)(n.code,{children:"ecu"}),": ",(0,i.jsx)(n.code,{children:"LX1"})," or ",(0,i.jsx)(n.code,{children:"ECU2"})," exist."]})]})}function h(e={}){const{wrapper:n}={...(0,s.R)(),...e.components};return n?(0,i.jsx)(n,{...e,children:(0,i.jsx)(r,{...e})}):r(e)}},8453:(e,n,t)=>{t.d(n,{R:()=>d,x:()=>o});var i=t(6540);const s={},l=i.createContext(s);function d(e){const n=i.useContext(l);return i.useMemo((function(){return"function"==typeof e?e(n):{...n,...e}}),[n,e])}function o(e){let n;return n=e.disableParentContext?"function"==typeof e.components?e.components(s):e.components||s:d(e.components),i.createElement(l.Provider,{value:n},e.children)}}}]);