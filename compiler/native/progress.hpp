#pragma once
#include <chrono>
#include <cstdlib>
#include <exception>
#include <filesystem>
#include <iostream>
#include <string>
#include <vector>
#include <unistd.h>
#include <sys/ioctl.h>

namespace estc {
class Progress;
inline Progress* activeProgress=nullptr;
class Progress {
 using Clock=std::chrono::steady_clock;
 bool verbose_,animated_,drawn_=false;
 std::string label_,detail_;
 Clock::time_point started_=Clock::now(),phase_=started_,last_=started_;
 size_t frame_=0;
 Progress* previous_;
 static long milliseconds(Clock::time_point start){return std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now()-start).count();}
 static std::string scope(const std::string& label){
  if(label.find("configuración")!=std::string::npos||label.starts_with("Leyendo"))return "setup";
  if(label.starts_with("Analizando")||label.starts_with("Verificando"))return "check";
  if(label.starts_with("Guardando"))return "emit";
  if(label.starts_with("Creando")||label.starts_with("Actualizando"))return "init";
  return "build";
 }
 std::string tag(const std::string& label)const{return animated_?"\x1b[35m["+scope(label)+"]\x1b[0m":"["+scope(label)+"]";}
 static std::string duration(long ms){
  if(ms<1000)return std::to_string(ms)+" ms";
  if(ms<60000){auto fraction=std::to_string((ms%1000)/10);return std::to_string(ms/1000)+"."+(fraction.size()<2?"0":"")+fraction+" s";}
  return std::to_string(ms/60000)+" min "+std::to_string(ms%60000/1000)+" s";
 }
 static std::string clean(std::string text){for(char& c:text)if(static_cast<unsigned char>(c)<32||c==127)c=' ';return text;}
 static std::string displayPath(const std::string& text){
  std::error_code ec;auto cwd=std::filesystem::current_path(ec);if(ec)return clean(text);
  auto path=std::filesystem::path(text);auto local=path.is_absolute()?path.lexically_relative(cwd).string():text;
  return clean(!local.empty()&&!local.starts_with("..")?local:text);
 }
public:
 Progress(bool verbose,bool enabled):verbose_(verbose),previous_(activeProgress){
  auto term=std::getenv("TERM"),ci=std::getenv("CI");
  animated_=enabled&&isatty(STDERR_FILENO)&&!std::getenv("NO_COLOR")&&(!term||std::string(term)!="dumb")&&(!ci||!*ci);
  activeProgress=this;
 }
 ~Progress(){finish(std::uncaught_exceptions()>0);activeProgress=previous_;}
 bool animated()const{return animated_&&!label_.empty();}
 void clear(){if(drawn_){std::cerr<<"\r\x1b[2K"<<std::flush;drawn_=false;}}
 void tick(bool force=false){
  if(!animated()||(!force&&milliseconds(last_)<80))return;
  static const char* frames[]={"⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"};
  winsize window{};size_t width=80;
  if(ioctl(STDERR_FILENO,TIOCGWINSZ,&window)==0&&window.ws_col)width=window.ws_col;
  auto suffix=" · "+duration(milliseconds(phase_));auto prefix="["+scope(label_)+"] ";
  auto text=detail_.empty()?label_:detail_;
  text=clean(text);
  // Leave a margin to avoid line wrapping; never split a UTF-8 code point.
  size_t limit=width>suffix.size()+prefix.size()+5?width-suffix.size()-prefix.size()-5:1;
  std::vector<size_t> points{0};
  for(size_t at=0;at<text.size();){++at;while(at<text.size()&&(static_cast<unsigned char>(text[at])&0xc0)==0x80)++at;points.push_back(at);}
  if(points.size()-1>limit){
   auto left=(limit-1)/2,right=limit-1-left;
   text=text.substr(0,points[left])+"…"+text.substr(points[points.size()-1-right]);
  }
  std::cerr<<"\r\x1b[2K"<<tag(label_)<<" \x1b[36m"<<frames[frame_++%10]<<"\x1b[0m "<<text<<"\x1b[2m"<<suffix<<"\x1b[0m"<<std::flush;
  drawn_=true;last_=Clock::now();
 }
 void start(const std::string& label){finish();label_=label;detail_.clear();phase_=Clock::now();frame_=0;if(animated_)tick(true);else if(verbose_)std::cerr<<tag(label_)<<" > "<<label_<<'\n';}
 void finish(bool failed=false){
  if(label_.empty())return;clear();
  if(animated_||verbose_){std::cerr<<tag(label_)<<' ';if(animated_)std::cerr<<(failed?"\x1b[31m":"\x1b[32m");std::cerr<<(failed?"✗":"✓");if(animated_)std::cerr<<"\x1b[0m";std::cerr<<' '<<label_<<" ("<<duration(milliseconds(phase_))<<")\n";}
  label_.clear();
 }
 void detail(const std::string& text){
  if(!verbose_&&(!animated_||!text.starts_with("frontend: ")))return;
  if(animated_){detail_=!verbose_&&text.starts_with("frontend: ")?text.substr(10):text;tick(true);}else std::cerr<<"  "<<text<<'\n';
 }
 void summary(const std::string& cpp="",const std::string& binary=""){
  finish();if(verbose_||animated_)std::cerr<<(animated_?"\x1b[35m[etsc]\x1b[0m \x1b[32m✓\x1b[0m":"[etsc] ✓")<<" Compilación completada ("<<duration(milliseconds(started_))<<")\n";
  if(animated_&&!verbose_){if(!cpp.empty())std::cerr<<"\x1b[2m       ↳\x1b[0m C++  "<<displayPath(cpp)<<'\n';if(!binary.empty())std::cerr<<"\x1b[2m       ↳\x1b[0m bin  "<<displayPath(binary)<<'\n';}
 }
};
inline void progressStart(const std::string& label){if(activeProgress)activeProgress->start(label);}
inline void progressDetail(const std::string& text){if(activeProgress)activeProgress->detail(text);}
}
