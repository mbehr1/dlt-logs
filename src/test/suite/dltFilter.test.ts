import * as assert from 'assert';

import { DltFilter, DltFilterType } from '../../dltFilter';
import { FilterableDltMsg, MSTP } from '../../dltParser';
import { containsRegexChars } from '../../util';

suite('DltFilter class test suite', () => {
  test('containsRegexChars', () => {
    assert(containsRegexChars('') === false);
    assert(containsRegexChars('ECU') === false);
    assert(containsRegexChars('abc') === false);
    assert(containsRegexChars('^abc') === true);
    assert(containsRegexChars('abc$') === true);
    assert(containsRegexChars('abc*') === true);
    assert(containsRegexChars('abc+') === true);
    assert(containsRegexChars('abc?') === true);
    assert(containsRegexChars('abc(') === true);
    assert(containsRegexChars('abc)') === true);
    assert(containsRegexChars('abc[') === true);
    assert(containsRegexChars('abc]') === true);
    assert(containsRegexChars('abc{') === true);
    assert(containsRegexChars('abc}') === true);
    assert(containsRegexChars('abc|foo') === true);
    assert(containsRegexChars('abc.') === true);
    assert(containsRegexChars('abc-') === true);
    assert(containsRegexChars('abc\\') === true);
    assert(containsRegexChars('abc=') === true);
    assert(containsRegexChars('abc!') === true);
    assert(containsRegexChars('abc<') === true);
  });

  test('filter from object', () => {
    const dltFilter = new DltFilter({ type: 0, ecu: 'ECU', apid: 'APID', ctid: 'CTID' });
    assert(!(dltFilter.ecu instanceof RegExp));
    assert(!(dltFilter.apid instanceof RegExp));
    assert(!(dltFilter.ctid instanceof RegExp));
    assert.equal(dltFilter.apid, 'APID');
  });

  test('parse dlf ex1 sw version', () => {
    const ex1 = `
        <?xml version="1.0" encoding="UTF-8"?>
            <dltfilter>
                <filter>
                    <type>0</type>
                    <name>Get Software Version</name>
                    <ecuid></ecuid>
                    <applicationid></applicationid>
                    <contextid></contextid>
                    <headertext></headertext>
                    <payloadtext>get_software_version</payloadtext>
                    <enableregexp>0</enableregexp>
                    <enablefilter>1</enablefilter>
                    <enableecuid>0</enableecuid>
                    <enableapplicationid>0</enableapplicationid>
                    <enablecontextid>0</enablecontextid>
                    <enableheadertext>0</enableheadertext>
                    <enablepayloadtext>1</enablepayloadtext>
                    <enablectrlmsgs>1</enablectrlmsgs>
                    <enableLogLevelMin>0</enableLogLevelMin>
                    <enableLogLevelMax>0</enableLogLevelMax>
                    <enableLMarker>0</enableLMarker>
                    <filterColour>#f0f0f0</filterColour>
                    <logLevelMax>0</logLevelMax>
                    <logLevelMin>0</logLevelMin>
                </filter>
            </dltfilter>`;

    let filters = DltFilter.filtersFromXmlDlf(ex1);
    assert(Array.isArray(filters));
    assert.equal(1, filters.length);
    let filter = filters[0];
    assert.equal(typeof filter, 'object');
    //console.warn(`filter='${JSON.stringify(filter, undefined, 2)}'`);
    // ensure that we can pass this to DltFilter constructor:
    const dltFilter = new DltFilter(filter);
    assert.equal(DltFilterType.POSITIVE, dltFilter.type);
    assert.equal(MSTP.TYPE_CONTROL, dltFilter.mstp, 'mismatching mstp');
  });
  test('parse dlf ex2_3', () => {
    const ex1 = `
        <?xml version="1.0" encoding="UTF-8"?>
        <dltfilter>
            <filter>
                <type>0</type>
                <name>Error/Fatal Messages</name>
                <ecuid></ecuid>
                <applicationid></applicationid>
                <contextid></contextid>
                <headertext></headertext>
                <payloadtext></payloadtext>
                <enableregexp>0</enableregexp>
                <enablefilter>1</enablefilter>
                <enableecuid>0</enableecuid>
                <enableapplicationid>0</enableapplicationid>
                <enablecontextid>0</enablecontextid>
                <enableheadertext>0</enableheadertext>
                <enablepayloadtext>0</enablepayloadtext>
                <enablectrlmsgs>0</enablectrlmsgs>
                <enableLogLevelMin>1</enableLogLevelMin>
                <enableLogLevelMax>1</enableLogLevelMax>
                <enableLMarker>0</enableLMarker>
                <filterColour>#f0f0f0</filterColour>
                <logLevelMax>2</logLevelMax>
                <logLevelMin>1</logLevelMin>
            </filter>
            <filter>
                <type>0</type>
                <name>Message Buffer overflow</name>
                <ecuid></ecuid>
                <applicationid></applicationid>
                <contextid></contextid>
                <headertext>2013/05/31 20:34:10.092828 3381.3386 0 ENAT DA1 DC1 control response non-verbose 1</headertext>
                <payloadtext>message_buffer_overflow ok</payloadtext>
                <enableregexp>0</enableregexp>
                <enablefilter>1</enablefilter>
                <enableecuid>0</enableecuid>
                <enableapplicationid>0</enableapplicationid>
                <enablecontextid>0</enablecontextid>
                <enableheadertext>0</enableheadertext>
                <enablepayloadtext>1</enablepayloadtext>
                <enablectrlmsgs>1</enablectrlmsgs>
                <enableLogLevelMin>0</enableLogLevelMin>
                <enableLogLevelMax>0</enableLogLevelMax>
                <enableLMarker>0</enableLMarker>
                <filterColour>#f0f0f0</filterColour>
                <logLevelMax>0</logLevelMax>
                <logLevelMin>0</logLevelMin>
            </filter>
        </dltfilter>`;

    let filters = DltFilter.filtersFromXmlDlf(ex1);
    assert(Array.isArray(filters));
    assert.equal(2, filters.length, 'mismatching number of filters');
    let filter = filters[0];
    //console.warn(`filter='${JSON.stringify(filter, undefined, 2)}'`);
    // ensure that we can pass this to DltFilter constructor:
    const dltFilter = new DltFilter(filter);
    assert.equal(DltFilterType.POSITIVE, dltFilter.type);
    assert.equal(2, dltFilter.logLevelMax, 'mismatching logLevelMax');
    assert.equal(1, dltFilter.logLevelMin, 'mismatching logLevelMin');
    assert.equal(dltFilter.ignoreCasePayload, false);
    filter = filters[1];
    console.warn(`filter[1]='${JSON.stringify(filter, undefined, 2)}'`);
  });

  test('check case sensitive payload', () => {
    const ex = `
        <?xml version="1.0" encoding="UTF-8"?>
            <dltfilter>
                <filter>
                    <type>0</type>
                    <payloadtext>get_software_version</payloadtext>
                    <ignoreCase_Payload>0</ignoreCase_Payload>
                    <enableregexp>0</enableregexp>
                    <enablefilter>1</enablefilter>
                    <enablepayloadtext>1</enablepayloadtext>
                </filter>
            </dltfilter>`;
    let filters = DltFilter.filtersFromXmlDlf(ex);
    const dltFilter = new DltFilter(filters[0]);
    assert.equal(dltFilter.ignoreCasePayload, false);
    let msg: FilterableDltMsg = {
      timeStamp: 0,
      mstp: 0,
      ecu: '',
      apid: '',
      ctid: '',
      mtin: 0,
      verbose: true,
      payloadString: 'I have get_software_version in my payload',
      asRestObject: (i) => {
        return { id: i, type: '' };
      },
    };
    assert(dltFilter.matches(msg), 'failed to match same case');
    msg.payloadString = 'I have get_Software_Version in my payload';
    assert(!dltFilter.matches(msg), 'failed to not match ignoring case');
  });

  test('check case insensitive payload', () => {
    const ex = `
        <?xml version="1.0" encoding="UTF-8"?>
            <dltfilter>
                <filter>
                    <type>0</type>
                    <payloadtext>get_software_version</payloadtext>
                    <ignoreCase_Payload>1</ignoreCase_Payload>
                    <enableregexp>0</enableregexp>
                    <enablefilter>1</enablefilter>
                    <enablepayloadtext>1</enablepayloadtext>
                </filter>
            </dltfilter>`;
    let filters = DltFilter.filtersFromXmlDlf(ex);
    const dltFilter = new DltFilter(filters[0]);
    assert.equal(dltFilter.ignoreCasePayload, true);
    let msg: FilterableDltMsg = {
      timeStamp: 0,
      mstp: 0,
      ecu: '',
      apid: '',
      ctid: '',
      mtin: 0,
      verbose: true,
      payloadString: 'I have get_software_version in my payload',
      asRestObject: (i) => {
        return { id: i, type: '' };
      },
    };
    assert(dltFilter.matches(msg), 'failed to match same case');
    msg.payloadString = 'I have get_Software_Version in my payload';
    assert(dltFilter.matches(msg), 'failed to match ignoring case');
  });

  test('check case sensitive payload regex', () => {
    const ex = `
        <?xml version="1.0" encoding="UTF-8"?>
            <dltfilter>
                <filter>
                    <type>0</type>
                    <payloadtext>^get_software_version</payloadtext>
                    <ignoreCase_Payload>0</ignoreCase_Payload>
                    <enableregexp>1</enableregexp>
                    <enablefilter>1</enablefilter>
                    <enablepayloadtext>1</enablepayloadtext>
                </filter>
            </dltfilter>`;
    let filters = DltFilter.filtersFromXmlDlf(ex);
    const dltFilter = new DltFilter(filters[0]);
    assert.equal(dltFilter.ignoreCasePayload, false);
    let msg: FilterableDltMsg = {
      timeStamp: 0,
      mstp: 0,
      ecu: '',
      apid: '',
      ctid: '',
      mtin: 0,
      verbose: true,
      payloadString: 'I have get_software_version in my payload',
      asRestObject: (i) => {
        return { id: i, type: '' };
      },
    };
    assert(!dltFilter.matches(msg), 'failed to not match same case');
    msg.payloadString = 'get_software_version in my payload';
    assert(dltFilter.matches(msg), 'failed to match same case');
    msg.payloadString = 'get_Software_version in my payload';
    assert(!dltFilter.matches(msg), 'failed to not match same case');
  });

  test('check case insensitive payload regex', () => {
    const ex = `
        <?xml version="1.0" encoding="UTF-8"?>
            <dltfilter>
                <filter>
                    <type>0</type>
                    <payloadtext>^get_software_version</payloadtext>
                    <ignoreCase_Payload>1</ignoreCase_Payload>
                    <enableregexp>1</enableregexp>
                    <enablefilter>1</enablefilter>
                    <enablepayloadtext>1</enablepayloadtext>
                </filter>
            </dltfilter>`;
    let filters = DltFilter.filtersFromXmlDlf(ex);
    const dltFilter = new DltFilter(filters[0]);
    assert.equal(dltFilter.ignoreCasePayload, true);
    let msg: FilterableDltMsg = {
      timeStamp: 0,
      mstp: 0,
      ecu: '',
      apid: '',
      ctid: '',
      mtin: 0,
      verbose: true,
      payloadString: 'I have get_software_version in my payload',
      asRestObject: (i) => {
        return { id: i, type: '' };
      },
    };
    assert(!dltFilter.matches(msg), 'failed to not match same case');
    msg.payloadString = 'get_software_version in my payload';
    assert(dltFilter.matches(msg), 'failed to match same case');
    msg.payloadString = 'Get_Software_Version in my payload';
    assert(dltFilter.matches(msg), 'failed to match different case');
  });
});
