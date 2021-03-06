import {Range} from 'vscode';
import * as fs from 'fs';

interface GDScript {
  constants: {},
  functions: {},
  variables: {},
  signals: {},
  classes: {},
  base: string,
  native: string,
  signatures: {},
  // symbol: marked string
  documents: {},
  // name : value
  constvalues: {},
  enumerations: {}
}

class GDScriptSymbolParser {
  constructor() {
  }

  parseContent(content: string, ignoreIndentedVars:boolean = false): GDScript {
    const script: GDScript = {
        constants: {},
        functions: {},
        variables: {},
        signals: {},
        classes: {},
        base: "",
        native: "",
        signatures: {},
        documents: {},
        constvalues: {},
        enumerations: {}
    }
    const text  = content;
    const lines = text.split(/\r?\n/);
    
    // Base class and native class
    for (let line of lines) {
      let match;
      if (match = line.match(/extends\s+(\w+)/)) {
        script.native = match[1];
        break;
      } else if (match = line.match(/extends\s+('|")(.*)('|")/)) {
        script.base = match[2];
      }
    }

    const getMatches = (regex:RegExp, index=1) => {
      var matches = [];
      for(let line of lines) {
        let match;
        if (match = regex.exec(line)) {
          let commentReg = RegExp(/#.*?/.source+regex.source);
          if(!commentReg.exec(line))
            matches.push(match[index]);
        }
      }
      return matches;
      // var matches = [];
      // var match;
      // while (match = regex.exec(string)) {
      //   matches.push(match[index]);
      // }
      // return matches;
    };
    
    const findLineRanges = (symbols, reg)=>{
      const sm = {};
      symbols.map((name:string)=>{
        let line = 0;
        let curline = 0;
        if(Object.keys(sm).indexOf(name) != -1) return;
        lines.map(l=>{
          const nreg = reg.replace("$X$", name);
          if(l.match(nreg) != null) {
            line = curline;
            return;
          }
          curline += 1;
        });
        sm[name] = line;
      });
      return sm;
    }
    
    const determRange = (key:string, array: any): Range =>{
      let line = array[key];
      let startAt = lines[line].indexOf(key);
      if(line < 0) line = 0;
      if(startAt < 0) startAt = 0;
      return new Range(line, startAt, line, startAt + key.length);
    };

    const parseSignature = (range: Range):string => {
      let res = "";
      const line = lines[range.start.line];
      if(line.indexOf("(")!= -1 && line.indexOf(")")!=-1) {
        const signature = line.substring(line.indexOf("("), line.indexOf(")")+1);
        if(signature && signature.length >0)
          res = signature;
      }
      return res;
    };

    const parseDocument = (range: Range):string => {
      let mdoc = ""
      let line = range.start.line;
      while( line > 0){
        const linecontent = lines[line];
        let match = linecontent.match(/\s*#\s*(.*)/);
        let commentAtEnd = linecontent.match(/[\w'",\[\{\]\}\(\)]+\s*#\s*(.*)/) != null;
        if(commentAtEnd && linecontent.match(/^#/))
          commentAtEnd = false;
        if(!match && line != range.start.line)
          break;
        if(commentAtEnd && line != range.start.line)
          break;
        if(match) {
          let lmcontent = linecontent.substring(linecontent.indexOf("#")+1, linecontent.length);
          if(lmcontent.startsWith(" ") && lmcontent != " ")
            lmcontent = lmcontent.substring(1, lmcontent.length);
          mdoc = lmcontent + "\r\n" + mdoc;
        }
        else if(line != range.start.line)
          break
        --line;
      }
      return mdoc;
    }
    
    let funcsnames = getMatches(/func\s+([_A-Za-z]+[_A-Za-z0-9]*)\s*\(/, 1);
    const funcs = findLineRanges(funcsnames, "func\\s+$X$\\s*\\(");
    for (let key of Object.keys(funcs)) {
      let r: Range = determRange(key, funcs);
      script.functions[key] = r;
      script.signatures[key] = parseSignature(r);
      script.documents[key] = parseDocument(r);
    }
    
    let signalnames = getMatches(/signal\s+([_A-Za-z]+[_A-Za-z0-9]*)\s*\(/, 1);
    const signals = findLineRanges(signalnames, "signal\\s+$X$\\s*\\(");
    for (let key of Object.keys(signals)) {
      let r: Range = determRange(key, signals);
      script.signals[key] = r;
      script.signatures[key] = parseSignature(r);
      script.documents[key] = parseDocument(r);
    }

    let varreg = /var\s+([_A-Za-z]+[_A-Za-z0-9]*)\s*/;
    let varreg2 = "var\\s+$X$([^\\w]|$)";
    let vargroup = 1;
    if(ignoreIndentedVars) {
      varreg = /^((export.*?var)|var)\s+([_A-Za-z]+[_A-Za-z0-9]*)\s?/;
      varreg2 = "^((export.*?var)|var)\\s+$X$\\s?";
      vargroup = 3;
    }
    let varnames = getMatches(varreg, vargroup);
    const vars = findLineRanges(varnames, varreg2);
    for (let key of Object.keys(vars)){
      const r:Range = determRange(key, vars)
      script.variables[key] = r;
      let newdoc = parseDocument(r);
      if(newdoc == "" && script.documents[key])
        newdoc = script.documents[key];
      script.documents[key] = newdoc;
    }
    
    let constnames = getMatches(/const\s+([_A-Za-z]+[_A-Za-z0-9]*)\s*/, 1);
    const consts = findLineRanges(constnames, "const\\s+$X$\\s*");
    for (let key of Object.keys(consts)){
      const r:Range = determRange(key, consts)
      script.constants[key] = r;
      let newdoc = parseDocument(r);
      if(newdoc == "" && script.documents[key])
        newdoc = script.documents[key];
      script.documents[key] = newdoc;
      
      const linecontent = lines[r.start.line];
      const match = linecontent.match(/const\s+([_A-Za-z]+[_A-Za-z0-9]*)\s*=\s*([\w+]+\(.*\)|"[^"]*"|\-?\d+\.?\d*|\[.*\]|\{.*\})/);
      if(match && match.length && match.length >1)
        script.constvalues[key] = match[2];
    }
    
    let classnames = getMatches(/class\s+([_A-Za-z]+[_A-Za-z0-9]*)(\s|\:)/, 1);
    const classes = findLineRanges(classnames, "class\\s+$X$(\\s|\\:)");
    for (let key of Object.keys(classes)) {
      const r:Range = determRange(key, classes)
      script.classes[key] = r;
      script.documents[key] = parseDocument(r);
    }

    let enumnames = getMatches(/enum\s+([_A-Za-z]+[_A-Za-z0-9]*)\s+\{/, 1);
    const enums = findLineRanges(enumnames, "enum\\s+$X$\\s+\{");
    for (let key of Object.keys(enums)) {
      const r:Range = determRange(key, enums)
      script.constants[key] = r;
      script.documents[key] = parseDocument(r);
      
      let curindex = r.start.line
      while (curindex < lines.length) {
        const line = lines[curindex];
        let matchs = line.match(/([_A-Za-z]+[_A-Za-z0-9]*)/g);
        if(matchs && matchs.length >= 1 ){
          for (var i = 0; i < matchs.length; i++)
            if(line.indexOf(matchs[i]) > line.indexOf("{"))
              script.enumerations[matchs[i]] = new Range(curindex, 0, curindex, line.length);
        }
        if(line.indexOf("}") == -1)
          curindex += 1;
        else
          break;
      }
    }
    // TODO: enumerations without name
    // const unnamedEnums = text.match(/enum\s+\{.*\}/gm)


    return script;
  }

  parseFile(path:string, ignoreIndentedVars:boolean = false): GDScript {
    const self = this;
    if(fs.existsSync(path) && fs.statSync(path).isFile()){
      const content = fs.readFileSync(path, 'utf-8');
      return this.parseContent(content, ignoreIndentedVars);
    }
    return null;
  }

}

export default GDScriptSymbolParser;