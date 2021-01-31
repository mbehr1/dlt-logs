import React, { useState, useEffect } from 'react';

export default function EscapePayload() {
    const [text, setText] = useState('');
    const [json, setJson] = useState(JSON.stringify(''));

    useEffect(() => {
        const newJson = JSON.stringify(text);
        if (newJson !== json) {
            setJson(newJson);
        }
    }, [text]);

    useEffect(() => {
        try {
            const newText = JSON.parse(json);
            if (newText !== text) {
                setText(newText);
            }
        } catch {

        }
    }, [json]);

    return (<form>
        <label>
            payloadRegex:<br />
            <input size={50} value={text} placeholder='enter your payload regular expression here' type="text" name="payloadRegex" onChange={(event) => setText(event.target.value)} />
        </label>
        <div></div>
        <label>
            escaped as JSON:<br />
            <input size={50} type="text" value={json} onChange={(event) => setJson(event.target.value)} />
        </label>
    </form >);
}
